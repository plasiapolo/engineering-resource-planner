import { Prisma, type PrismaClient, type PlanEntry } from "@prisma/client";
import type {
  ApiAvailability,
  ApiConflict,
  ApiDependency,
  ApiPlanEntry,
  ApiProject,
  ApiTask,
  ApiTeamMember,
  ApiUser,
  ApiVersionSummary,
  DateString,
  PlannerSummary,
  Role,
  TaskStatus,
} from "../../domain/types";
import {
  addDays,
  addMonths,
  compareDates,
  isWorkingDay,
  toDate,
  toDateString,
  warsawToday,
  workingDaysBetween,
} from "../calendar/polishCalendar";
import { detectConflicts } from "../conflicts/conflictDetection";
import { generatePlan } from "../planner/planner";
import {
  buildSnapshotContent,
  snapshotDateKey,
  snapshotEquals,
  type SnapshotContent,
} from "../versioning/snapshot";
import {
  buildDependenciesFromRows,
  buildTaskCode,
  checkStatusTransition,
  codePartOf,
  mergeAssignments,
  nextTaskNumber,
  parseTaskNumber,
  specialistCodeFromLogin,
  uniqueNumbersForTasks,
} from "./logic";
import {
  toApiAvailability,
  toApiConflict,
  toApiEntry,
  toApiProject,
  toApiTask,
  toApiUser,
  toDateString as toDs,
} from "./mappers";

export interface AppData {
  user: ApiUser;
  projects: ApiProject[];
  tasks: ApiTask[];
  dependencies: ApiDependency[];
  planEntries: ApiPlanEntry[];
  conflicts: ApiConflict[];
  versions: ApiVersionSummary[];
  team: ApiTeamMember[];
  availability: ApiAvailability[];
}

const DEFAULT_WORKING_HOURS = 8;

interface CreateProjectInput {
  name: string;
  deadline: DateString;
  budgetHours: number;
}

interface UpdateProjectInput {
  name?: string;
  deadline?: DateString;
  budgetHours?: number;
}

interface CreateTaskInput {
  projectId: string;
  name: string;
  requiredSkill: string;
  estimatedHours: number;
  taskDeadline?: DateString | null;
  rowIndex?: number;
}

interface UpdateTaskInput {
  name?: string;
  estimatedHours?: number;
  taskDeadline?: DateString | null;
  status?: TaskStatus;
  requiredSkill?: string;
  rowIndex?: number;
}

export class StorageService {
  constructor(private readonly db: PrismaClient) {}

  // ---------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------
  async audit(userId: string, entityType: string, entityId: string | null, action: string): Promise<void> {
    await this.db.auditLog.create({
      data: { userId, entityType, entityId, action },
    });
  }

  // ---------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------
  async loadAppData(userId: string): Promise<AppData> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const [projects, tasks, dependencies, planEntries, conflicts, versions, availability, users] =
      await Promise.all([
        this.db.project.findMany({
          where: { deletedAt: null },
          include: { tasks: { where: { deletedAt: null } } },
          orderBy: { createdAt: "asc" },
        }),
        this.db.task.findMany({
          where: { deletedAt: null },
          include: {
            project: true,
            planEntries: { where: { deletedAt: null }, include: { user: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        this.db.taskDependency.findMany({ where: { deletedAt: null } }),
        this.db.planEntry.findMany({
          where: { deletedAt: null },
          include: { task: true, user: true },
          orderBy: [{ date: "asc" }, { id: "asc" }],
        }),
        this.db.conflict.findMany({
          where: { deletedAt: null },
          include: { project: true, task: true, employee: true },
          orderBy: { createdAt: "asc" },
        }),
        this.db.versionSnapshot.findMany({ orderBy: { snapshotDate: "desc" } }),
        this.db.availability.findMany({ orderBy: { date: "asc" } }),
        this.db.user.findMany({ orderBy: { login: "asc" } }),
      ]);

    const plannedByUser = new Map<string, number>();
    for (const entry of planEntries) {
      plannedByUser.set(entry.userId, (plannedByUser.get(entry.userId) ?? 0) + entry.hours);
    }

    const availabilityByUser = new Map<string, Map<DateString, number>>();
    for (const a of availability) {
      const dateStr = toDateString(a.date);
      const perUser = availabilityByUser.get(a.userId) ?? new Map<DateString, number>();
      perUser.set(dateStr, a.availableHours);
      availabilityByUser.set(a.userId, perUser);
    }

    const today = warsawToday();
    const horizon = addMonths(today, 3);
    const capacityFor = (userId: string): number => {
      const perUser = availabilityByUser.get(userId);
      let capacity = 0;
      let day = today;
      while (compareDates(day, horizon) <= 0) {
        if (isWorkingDay(day)) {
          capacity += perUser?.get(day) ?? DEFAULT_WORKING_HOURS;
        }
        day = addDays(day, 1);
      }
      return capacity;
    };
    const plannedInWindow = (userId: string): number =>
      planEntries
        .filter(
          (e) =>
            e.userId === userId &&
            compareDates(toDateString(e.date), today) >= 0 &&
            compareDates(toDateString(e.date), horizon) <= 0,
        )
        .reduce((sum, e) => sum + e.hours, 0);

    const team: ApiTeamMember[] = users.map((u) => {
      const planned = plannedByUser.get(u.id) ?? 0;
      const availabilityHours = availability
        .filter((a) => a.userId === u.id)
        .reduce((sum, a) => sum + a.availableHours, 0);
      return {
        id: u.id,
        login: u.login,
        displayName: u.displayName,
        role: u.role,
        skill: u.skill,
        totalAvailabilityHours: availabilityHours,
        plannedHours: planned,
        availableHours: Math.max(0, DEFAULT_WORKING_HOURS - planned),
        availableHoursNext3Months: Math.max(0, capacityFor(u.id) - plannedInWindow(u.id)),
      };
    });

    return {
      user: toApiUser(user),
      projects: projects.map(toApiProject),
      tasks: tasks.map(toApiTask),
      dependencies: dependencies.map((d) => ({
        id: d.id,
        predecessorTaskId: d.predecessorTaskId,
        successorTaskId: d.successorTaskId,
      })),
      planEntries: planEntries.map(toApiEntry),
      conflicts: conflicts.map(toApiConflict),
      versions: versions.map((v) => ({
        id: v.id,
        snapshotDate: toDateString(v.snapshotDate),
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
        planEntriesCount: ((v.planEntriesJson as unknown as SnapshotContent)?.planEntries ?? []).length,
        conflictsCount: ((v.planEntriesJson as unknown as SnapshotContent)?.conflicts ?? []).length,
      })),
      team,
      availability: availability.map(toApiAvailability),
    };
  }

  // ---------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------
  async createProject(input: CreateProjectInput, userId: string): Promise<ApiProject> {
    const count = await this.db.project.count({ where: { deletedAt: null } });
    const code = `P${count + 1}`;
    const project = await this.db.project.create({
      data: {
        code,
        name: input.name,
        deadline: toDate(input.deadline),
        budgetHours: input.budgetHours,
      },
      include: { tasks: { where: { deletedAt: null } } },
    });
    await this.audit(userId, "PROJECT", project.id, "CREATED");
    return toApiProject(project);
  }

  async updateProject(id: string, input: UpdateProjectInput, userId: string): Promise<ApiProject> {
    const project = await this.db.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.budgetHours !== undefined ? { budgetHours: input.budgetHours } : {}),
        ...(input.deadline !== undefined ? { deadline: toDate(input.deadline) } : {}),
      },
      include: { tasks: { where: { deletedAt: null } } },
    });
    await this.recomputeConflicts();
    await this.audit(userId, "PROJECT", project.id, "UPDATED");
    return toApiProject(project);
  }

  async deleteProject(id: string, userId: string): Promise<void> {
    const now = new Date();
    await this.db.$transaction([
      this.db.conflict.updateMany({ where: { projectId: id }, data: { deletedAt: now } }),
      this.db.planEntry.updateMany({ where: { task: { projectId: id } }, data: { deletedAt: now } }),
      this.db.taskDependency.updateMany({
        where: { predecessor: { projectId: id } },
        data: { deletedAt: now },
      }),
      this.db.taskDependency.updateMany({
        where: { successor: { projectId: id } },
        data: { deletedAt: now },
      }),
      this.db.task.updateMany({ where: { projectId: id }, data: { deletedAt: now } }),
      this.db.project.update({ where: { id }, data: { deletedAt: now } }),
    ]);
    await this.audit(userId, "PROJECT", id, "DELETED");
  }

  // ---------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------
  async createTask(input: CreateTaskInput, userId: string): Promise<ApiTask> {
    const project = await this.db.project.findUniqueOrThrow({ where: { id: input.projectId } });
    const existing = await this.db.task.findMany({
      where: { projectId: project.id, deletedAt: null },
    });
    const numbers = existing.map((t) => parseTaskNumber(t.taskCode));
    const number = nextTaskNumber(numbers);
    const rowIndex = input.rowIndex ?? 0;
    const code = buildTaskCode(project.code, input.requiredSkill, null, rowIndex, number);
    const task = await this.db.task.create({
      data: {
        projectId: project.id,
        taskCode: code,
        name: input.name ?? "",
        requiredSkill: input.requiredSkill as never,
        estimatedHours: input.estimatedHours,
        taskDeadline: input.taskDeadline ? toDate(input.taskDeadline) : null,
        rowIndex,
      },
      include: {
        project: true,
        planEntries: { where: { deletedAt: null }, include: { user: true } },
      },
    });
    await this.recomputeConflicts();
    await this.audit(userId, "TASK", task.id, "CREATED");
    return toApiTask(task);
  }

  async updateTask(id: string, input: UpdateTaskInput, userId: string): Promise<ApiTask> {
    const task = await this.db.task.findUniqueOrThrow({ where: { id } });
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      data.name = input.name;
    }
    if (input.estimatedHours !== undefined) {
      if (input.estimatedHours < 1) throw new Error("estimatedHours must be at least 1");
      data.estimatedHours = input.estimatedHours;
    }
    if (input.taskDeadline !== undefined) {
      data.taskDeadline = input.taskDeadline ? toDate(input.taskDeadline) : null;
    }
    if (input.status !== undefined) {
      data.status = input.status;
    }
    if (input.requiredSkill !== undefined) {
      data.requiredSkill = input.requiredSkill;
    }
    if (input.rowIndex !== undefined) {
      data.rowIndex = input.rowIndex;
      const code = codePartOf(task.taskCode);
      const parts = code.split("-");
      data.taskCode = `${parts[0]}-${parts[1]}-${input.rowIndex + 1}.${String(parseTaskNumber(task.taskCode)).padStart(6, "0")}`;
    }
    const updated = await this.db.task.update({
      where: { id },
      data,
      include: {
        project: true,
        planEntries: { where: { deletedAt: null }, include: { user: true } },
      },
    });
    await this.recomputeConflicts();
    await this.audit(userId, "TASK", task.id, "UPDATED");
    return toApiTask(updated);
  }

  async deleteTask(id: string, userId: string): Promise<void> {
    const now = new Date();
    await this.db.$transaction([
      this.db.conflict.updateMany({ where: { taskId: id }, data: { deletedAt: now } }),
      this.db.planEntry.updateMany({ where: { taskId: id }, data: { deletedAt: now } }),
      this.db.taskDependency.updateMany({
        where: { predecessorTaskId: id },
        data: { deletedAt: now },
      }),
      this.db.taskDependency.updateMany({ where: { successorTaskId: id }, data: { deletedAt: now } }),
      this.db.task.update({ where: { id }, data: { deletedAt: now } }),
    ]);
    await this.recomputeConflicts();
    await this.audit(userId, "TASK", id, "DELETED");
  }

  async updateTaskStatus(
    id: string,
    userId: string,
    role: Role,
    status: TaskStatus,
    actualWorkedHours?: number,
  ): Promise<ApiTask> {
    const task = await this.db.task.findUniqueOrThrow({
      where: { id },
      include: { project: true, planEntries: { where: { deletedAt: null }, include: { user: true } } },
    });

    if (role !== "PROJECT_MANAGER") {
      const isAssigned = task.planEntries.some((e) => e.userId === userId);
      if (!isAssigned) {
        throw new Error("A specialist may only update status of assigned tasks.");
      }
    }

    const check = checkStatusTransition(task.status, status, role);
    if (!check.allowed) {
      throw new Error(check.reason ?? "Invalid status transition.");
    }

    const data: Record<string, unknown> = { status };
    if (status === "DONE") {
      data.actualWorkedHours = actualWorkedHours ?? task.estimatedHours;
    } else if (actualWorkedHours !== undefined && actualWorkedHours >= 0) {
      data.actualWorkedHours = Math.min(actualWorkedHours, task.estimatedHours);
    }

    const updated = await this.db.task.update({
      where: { id },
      data,
      include: {
        project: true,
        planEntries: { where: { deletedAt: null }, include: { user: true } },
      },
    });
    await this.recomputeConflicts();
    await this.captureVersion();
    await this.audit(userId, "TASK", task.id, `STATUS_${task.status}_TO_${status}`);
    return toApiTask(updated);
  }

  // ---------------------------------------------------------------
  // Pyramid / dependencies
  // ---------------------------------------------------------------
  async savePyramid(projectId: string, rows: string[][], userId: string): Promise<void> {
    const tasks = await this.db.task.findMany({ where: { projectId, deletedAt: null } });
    const taskIds = tasks.map((t) => t.id);
    uniqueNumbersForTasks(rows.map((r) => r.map((id) => ({ id }))), taskIds);

    const deps = buildDependenciesFromRows(rows.map((r) => r.map((id) => ({ id }))));
    const now = new Date();

    const rowIndexById = new Map<string, number>();
    rows.forEach((row, index) => {
      row.forEach((id) => rowIndexById.set(id, index));
    });

    await this.db.$transaction(async (tx) => {
      await tx.taskDependency.updateMany({
        where: { predecessor: { projectId } },
        data: { deletedAt: now },
      });
      await tx.taskDependency.updateMany({
        where: { successor: { projectId } },
        data: { deletedAt: now },
      });
      if (deps.length > 0) {
        await tx.taskDependency.createMany({
          data: deps.map((d) => ({
            predecessorTaskId: d.predecessorTaskId,
            successorTaskId: d.successorTaskId,
          })),
          skipDuplicates: true,
        });
      }
      for (const [taskId, rowIndex] of rowIndexById) {
        const task = tasks.find((t) => t.id === taskId);
        if (!task) continue;
        const code = codePartOf(task.taskCode);
        const parts = code.split("-");
        const newCode = `${parts[0]}-${parts[1]}-${rowIndex + 1}.${String(parseTaskNumber(task.taskCode)).padStart(6, "0")}`;
        await tx.task.update({
          where: { id: taskId },
          data: { rowIndex, taskCode: newCode },
        });
      }
    });

    await this.recomputeConflicts();
    await this.audit(userId, "PROJECT", projectId, "PYRAMID_SAVED");
  }

  // ---------------------------------------------------------------
  // Plan entries (manual assignments)
  // ---------------------------------------------------------------
  async assignTask(
    taskId: string,
    assignments: Array<{ userId: string; date: DateString; hours: number }>,
    userId: string,
  ): Promise<ApiPlanEntry[]> {
    const task = await this.db.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { project: true },
    });

    for (const assignment of assignments) {
      const user = await this.db.user.findUniqueOrThrow({ where: { id: assignment.userId } });
      if (user.skill !== task.requiredSkill) {
        throw new Error(
          `User ${user.login} does not have the required skill ${task.requiredSkill}.`,
        );
      }
      if (!isWorkingDay(assignment.date)) {
        throw new Error(`Assignments are only allowed on working days (${assignment.date} is not).`);
      }
      if (assignment.hours < 1 || assignment.hours > 8) {
        throw new Error("Hours per day must be between 1 and 8.");
      }
    }

    const existing = await this.db.planEntry.findMany({
      where: { taskId, deletedAt: null },
    });

    const merged = mergeAssignments(
      existing.map((e) => ({ taskId: e.taskId, userId: e.userId, date: toDateString(e.date), hours: e.hours })),
      assignments.map((a) => ({ ...a, taskId })),
    );
    const created: PlanEntry[] = [];
    for (const item of merged) {
      if (item.create) {
        const entry = await this.db.planEntry.create({
          data: {
            taskId,
            userId: item.userId,
            date: toDate(item.date),
            hours: item.hours,
            locked: true,
          },
        });
        created.push(entry);
      } else {
        const target = existing.find(
          (e) => e.taskId === item.taskId && e.userId === item.userId && toDateString(e.date) === item.date,
        );
        if (target) {
          const updated = await this.db.planEntry.update({
            where: { id: target.id },
            data: { hours: target.hours + item.hours, locked: true },
          });
          created.push(updated);
        }
      }
    }

    await this.updateTaskCodeForAssignment(taskId, assignments[0]?.userId);
    await this.recomputeConflicts();
    await this.captureVersion();
    await this.audit(userId, "TASK", taskId, "ASSIGNED");

    return this.loadEntriesForTask(taskId);
  }

  async removeAssignment(taskId: string, userId: string, actorId: string): Promise<void> {
    const entries = await this.db.planEntry.findMany({
      where: { taskId, userId, deletedAt: null },
    });
    if (entries.length === 0) {
      throw new Error("No assignment found for this specialist on the task.");
    }
    await this.db.planEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { deletedAt: new Date() },
    });
    await this.updateTaskCodeForAssignment(taskId);
    await this.recomputeConflicts();
    await this.captureVersion();
    await this.audit(actorId, "TASK", taskId, "ASSIGNMENT_REMOVED");
  }

  async updatePlanEntry(
    entryId: string,
    input: { userId?: string; date?: DateString; hours?: number },
    userId: string,
  ): Promise<ApiPlanEntry> {
    const entry = await this.db.planEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { task: true, user: true },
    });

    const nextUser = input.userId ?? entry.userId;
    const nextDate = input.date ?? toDateString(entry.date);
    const nextHours = input.hours ?? entry.hours;

    if (input.userId !== undefined) {
      const user = await this.db.user.findUniqueOrThrow({ where: { id: input.userId } });
      if (user.skill !== entry.task.requiredSkill) {
        throw new Error(`Cannot assign to a user without the required skill ${entry.task.requiredSkill}.`);
      }
    }
    if (!isWorkingDay(nextDate)) {
      throw new Error(`Plan entries are only allowed on working days (${nextDate} is not).`);
    }
    if (nextHours < 1 || nextHours > 8) {
      throw new Error("Hours per day must be between 1 and 8.");
    }

    const updated = await this.db.planEntry.update({
      where: { id: entryId },
      data: { userId: nextUser, date: toDate(nextDate), hours: nextHours, locked: true },
      include: { task: true, user: true },
    });
    await this.updateTaskCodeForAssignment(entry.taskId, nextUser);
    await this.recomputeConflicts();
    await this.captureVersion();
    await this.audit(userId, "PLAN_ENTRY", entry.id, "UPDATED");
    return toApiEntry(updated);
  }

  async setPlanEntryLock(entryId: string, locked: boolean, userId: string): Promise<ApiPlanEntry> {
    const updated = await this.db.planEntry.update({
      where: { id: entryId },
      data: { locked },
      include: { task: true, user: true },
    });
    await this.audit(userId, "PLAN_ENTRY", updated.id, locked ? "LOCKED" : "UNLOCKED");
    return toApiEntry(updated);
  }

  async deletePlanEntry(entryId: string, userId: string): Promise<void> {
    const entry = await this.db.planEntry.findUniqueOrThrow({ where: { id: entryId } });
    await this.db.planEntry.update({
      where: { id: entryId },
      data: { deletedAt: new Date() },
    });
    await this.updateTaskCodeForAssignment(entry.taskId);
    await this.recomputeConflicts();
    await this.captureVersion();
    await this.audit(userId, "PLAN_ENTRY", entry.id, "DELETED");
  }

  private async updateTaskCodeForAssignment(taskId: string, preferredUserId?: string): Promise<void> {
    const task = await this.db.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { project: true, planEntries: { where: { deletedAt: null } } },
    });
    const assignedUsers = await this.db.user.findMany({
      where: { id: { in: task.planEntries.map((e) => e.userId) } },
    });
    assignedUsers.sort((a, b) => a.login.localeCompare(b.login));
    const chosen =
      (preferredUserId ? assignedUsers.find((u) => u.id === preferredUserId) : undefined) ?? assignedUsers[0];
    const code = codePartOf(task.taskCode);
    const parts = code.split("-");
    const skillPart = chosen
      ? `${task.requiredSkill}${specialistCodeFromLogin(chosen.login).replace(task.requiredSkill, "")}`
      : `${task.requiredSkill}X`;
    const newCode = `${parts[0]}-${skillPart}-${parts[2]}.${String(parseTaskNumber(task.taskCode)).padStart(6, "0")}`;
    if (newCode !== task.taskCode) {
      await this.db.task.update({ where: { id: taskId }, data: { taskCode: newCode } });
    }
  }

  private async loadEntriesForTask(taskId: string): Promise<ApiPlanEntry[]> {
    const entries = await this.db.planEntry.findMany({
      where: { taskId, deletedAt: null },
      include: { task: true, user: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    return entries.map(toApiEntry);
  }

  // ---------------------------------------------------------------
  // Availability
  // ---------------------------------------------------------------
  async upsertAvailability(
    targetUserId: string,
    startDate: DateString,
    endDate: DateString,
    availableHours: number,
    userId: string,
  ): Promise<ApiAvailability[]> {
    if (availableHours < 0 || availableHours > 8) {
      throw new Error("availableHours must be between 0 and 8.");
    }
    if (compareDates(startDate, endDate) > 0) {
      throw new Error("startDate must be before or equal endDate.");
    }
    const dates = workingDaysBetween(startDate, endDate);
    if (dates.length > 400) {
      throw new Error("Date range too large.");
    }
    const results: ApiAvailability[] = [];
    for (const date of dates) {
      const existing = await this.db.availability.findUnique({
        where: { userId_date: { userId: targetUserId, date: toDate(date) } },
      });
      if (existing) {
        const updated = await this.db.availability.update({
          where: { id: existing.id },
          data: { availableHours },
        });
        results.push(toApiAvailability(updated));
      } else {
        const created = await this.db.availability.create({
          data: { userId: targetUserId, date: toDate(date), availableHours },
        });
        results.push(toApiAvailability(created));
      }
    }
    await this.recomputeConflicts();
    await this.audit(userId, "USER", targetUserId, `AVAILABILITY_${availableHours}_HOURS`);
    return results;
  }

  async deleteAvailability(userId: string, date: DateString): Promise<void> {
    await this.db.availability.deleteMany({
      where: { userId, date: toDate(date) },
    });
    await this.recomputeConflicts();
  }

  // ---------------------------------------------------------------
  // Planner
  // ---------------------------------------------------------------
  async generatePlan(userId: string): Promise<PlannerSummary> {
    const projects = await this.db.project.findMany({ where: { deletedAt: null } });
    const tasks = await this.db.task.findMany({
      where: { deletedAt: null },
      include: { project: true },
    });
    const users = await this.db.user.findMany({ where: { role: "SPECIALIST" } });
    const availability = await this.db.availability.findMany();
    const locked = await this.db.planEntry.findMany({
      where: { locked: true, deletedAt: null },
    });
    const unlocked = await this.db.planEntry.findMany({
      where: { locked: false, deletedAt: null },
    });

    if (unlocked.length > 0) {
      await this.db.planEntry.updateMany({
        where: { id: { in: unlocked.map((e) => e.id) } },
        data: { deletedAt: new Date() },
      });
    }

    const availabilityMap: Record<string, Record<DateString, number>> = {};
    for (const a of availability) {
      const dateStr = toDateString(a.date);
      availabilityMap[a.userId] = availabilityMap[a.userId] ?? {};
      availabilityMap[a.userId][dateStr] = a.availableHours;
    }

    const result = generatePlan({
      projects: projects.map((p) => ({
        id: p.id,
        deadline: toDateString(p.deadline),
        budgetHours: p.budgetHours,
      })),
      tasks: tasks
        .filter((t) => t.status === "NOT_STARTED" || t.status === "WORK_IN_PROGRESS")
        .map((t) => ({
          id: t.id,
          projectId: t.projectId,
          requiredSkill: t.requiredSkill,
          remainingHours: Math.max(0, t.estimatedHours - t.actualWorkedHours),
          status: t.status,
          rowIndex: t.rowIndex,
        })),
      dependencies: [],
      users: users
        .filter((u) => u.skill !== null)
        .map((u) => ({ id: u.id, skill: u.skill as string })),
      availability: availabilityMap,
      lockedEntries: locked.map((e) => ({
        taskId: e.taskId,
        userId: e.userId,
        date: toDateString(e.date),
        hours: e.hours,
        locked: true,
      })),
      startDate: warsawToday(),
    });

    const toInsert = result.entries.filter((e) => !e.locked);
    if (toInsert.length > 0) {
      await this.db.planEntry.createMany({
        data: toInsert.map((e) => ({
          taskId: e.taskId,
          userId: e.userId,
          date: toDate(e.date),
          hours: e.hours,
          locked: false,
        })),
      });
      for (const taskId of [...new Set(toInsert.map((e) => e.taskId))]) {
        await this.updateTaskCodeForAssignment(taskId);
      }
    }

    await this.recomputeConflicts();
    await this.captureVersion();
    await this.audit(userId, "SYSTEM", null, "PLAN_GENERATED");
    return { entriesCreated: toInsert.length, failures: result.failures };
  }

  // ---------------------------------------------------------------
  // Conflicts
  // ---------------------------------------------------------------
  async recomputeConflicts(): Promise<ApiConflict[]> {
    const input = await this.loadConflictInput();
    const drafts = detectConflicts(input);
    await this.db.conflict.deleteMany({});
    if (drafts.length > 0) {
      await this.db.conflict.createMany({
        data: drafts.map((d) => ({
          type: d.type,
          title: d.title,
          description: d.description,
          severity: d.severity,
          projectId: d.projectId,
          taskId: d.taskId,
          employeeId: d.employeeId,
        })),
      });
    }
    const stored = await this.db.conflict.findMany({
      include: { project: true, task: true, employee: true },
      orderBy: { createdAt: "asc" },
    });
    return stored.map(toApiConflict);
  }

  private async loadConflictInput() {
    const [projects, tasks, deps, users, entries, availability] = await Promise.all([
      this.db.project.findMany({ where: { deletedAt: null } }),
      this.db.task.findMany({ where: { deletedAt: null } }),
      this.db.taskDependency.findMany({ where: { deletedAt: null } }),
      this.db.user.findMany(),
      this.db.planEntry.findMany({ where: { deletedAt: null }, orderBy: [{ date: "asc" }, { id: "asc" }] }),
      this.db.availability.findMany(),
    ]);
    const availabilityMap: Record<string, Record<DateString, number>> = {};
    for (const a of availability) {
      const dateStr = toDateString(a.date);
      availabilityMap[a.userId] = availabilityMap[a.userId] ?? {};
      availabilityMap[a.userId][dateStr] = a.availableHours;
    }
    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        deadline: toDateString(p.deadline),
        budgetHours: p.budgetHours,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        codePart: codePartOf(t.taskCode),
        requiredSkill: t.requiredSkill,
        estimatedHours: t.estimatedHours,
        remainingHours: Math.max(0, t.estimatedHours - t.actualWorkedHours),
        status: t.status,
        taskDeadline: t.taskDeadline ? toDateString(t.taskDeadline) : null,
        rowIndex: t.rowIndex,
      })),
      dependencies: deps.map((d) => ({
        predecessorTaskId: d.predecessorTaskId,
        successorTaskId: d.successorTaskId,
      })),
      users: users.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        skill: u.skill,
      })),
      entries: entries.map((e) => ({
        taskId: e.taskId,
        userId: e.userId,
        date: toDateString(e.date),
        hours: e.hours,
      })),
      availability: availabilityMap,
      today: warsawToday(),
    };
  }

  // ---------------------------------------------------------------
  // Versioning
  // ---------------------------------------------------------------
  async captureVersion(): Promise<void> {
    const businessDate = warsawToday();
    const [entries, conflicts] = await Promise.all([
      this.db.planEntry.findMany({
        where: { deletedAt: null },
        include: { task: true, user: true },
      }),
      this.db.conflict.findMany({ where: { deletedAt: null } }),
    ]);
    const content: SnapshotContent = buildSnapshotContent(
      entries.map((e) => ({
        taskId: e.taskId,
        taskCode: e.task.taskCode,
        userId: e.userId,
        userName: e.user.displayName,
        date: toDateString(e.date),
        hours: e.hours,
        locked: e.locked,
      })),
      conflicts.map((c) => ({
        type: c.type,
        title: c.title,
        description: c.description,
        severity: c.severity,
        projectId: c.projectId,
        taskId: c.taskId,
        employeeId: c.employeeId,
      })),
    );
    const key = snapshotDateKey(businessDate);
    const existing = await this.db.versionSnapshot.findUnique({ where: { snapshotDate: key } });
    if (existing) {
      const prev = existing.planEntriesJson as unknown as SnapshotContent;
      if (snapshotEquals(prev, content)) return;
      await this.db.versionSnapshot.update({
        where: { id: existing.id },
        data: {
          planEntriesJson: content as unknown as Prisma.InputJsonValue,
          conflictsJson: content as unknown as Prisma.InputJsonValue,
        },
      });
      return;
    }
    await this.db.versionSnapshot.create({
      data: {
        snapshotDate: key,
        planEntriesJson: content as unknown as Prisma.InputJsonValue,
        conflictsJson: content as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ---------------------------------------------------------------
  // Reset / wipe
  // ---------------------------------------------------------------
  async wipeAllProjects(userId: string): Promise<void> {
    const projects = await this.db.project.findMany({ where: { deletedAt: null } });
    for (const project of projects) {
      await this.deleteProject(project.id, userId);
    }
    await this.recomputeConflicts();
  }

  async listVersions() {
    return this.db.versionSnapshot.findMany({ orderBy: { snapshotDate: "desc" } });
  }

  async getVersion(id: string) {
    return this.db.versionSnapshot.findUniqueOrThrow({ where: { id } });
  }

  async listAudit() {
    return this.db.auditLog.findMany({
      include: { user: true },
      orderBy: { timestamp: "desc" },
      take: 500,
    });
  }
}

export type { CreateProjectInput, UpdateProjectInput, CreateTaskInput, UpdateTaskInput };

export { toDs };