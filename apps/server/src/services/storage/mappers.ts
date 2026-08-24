import type {
  Availability,
  Conflict,
  PlanEntry,
  Project,
  Task,
  User,
} from "@prisma/client";
import type {
  ApiAvailability,
  ApiConflict,
  ApiPlanEntry,
  ApiProject,
  ApiTask,
  ApiUser,
} from "../../domain/types";
import { codePartOf, parseTaskNumber } from "./logic";

type ProjectWithTasks = Project & { tasks: Task[] };
type TaskWithRelations = Task & {
  project: Project;
  planEntries: Array<PlanEntry & { user: User }>;
};
type EntryWithRelations = PlanEntry & { task: Task; user: User };
type ConflictWithRelations = Conflict & {
  project?: Project | null;
  task?: Task | null;
  employee?: User | null;
};

export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toApiUser(user: User): ApiUser {
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    role: user.role,
    skill: user.skill,
  };
}

export function toApiProject(project: ProjectWithTasks): ApiProject {
  const total = project.tasks.reduce((sum, t) => sum + t.estimatedHours, 0);
  const done = project.tasks.filter((t) => t.status === "DONE").length;
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    deadline: toDateString(project.deadline),
    budgetHours: project.budgetHours,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    tasksCount: project.tasks.length,
    doneTasksCount: done,
    totalEstimatedHours: total,
  };
}

export function toApiTask(task: TaskWithRelations): ApiTask {
  const assignedMap = new Map<string, { id: string; displayName: string; login: string; skill: Task["requiredSkill"] }>();
  let scheduledHours = 0;
  for (const entry of task.planEntries) {
    scheduledHours += entry.hours;
    if (!assignedMap.has(entry.userId)) {
      assignedMap.set(entry.userId, {
        id: entry.user.id,
        displayName: entry.user.displayName,
        login: entry.user.login,
        skill: entry.user.skill ?? task.requiredSkill,
      });
    }
  }
  return {
    id: task.id,
    projectId: task.projectId,
    projectCode: task.project.code,
    projectName: task.project.name,
    taskCode: task.taskCode,
    name: task.name,
    codePart: codePartOf(task.taskCode),
    requiredSkill: task.requiredSkill,
    estimatedHours: task.estimatedHours,
    actualWorkedHours: task.actualWorkedHours,
    remainingHours: Math.max(0, task.estimatedHours - task.actualWorkedHours),
    status: task.status,
    taskDeadline: task.taskDeadline ? toDateString(task.taskDeadline) : null,
    rowIndex: task.rowIndex,
    assignedUserIds: [...assignedMap.keys()],
    assignedUsers: [...assignedMap.values()],
    scheduledHours,
  };
}

export function toApiEntry(entry: EntryWithRelations): ApiPlanEntry {
  return {
    id: entry.id,
    taskId: entry.taskId,
    taskCode: entry.task.taskCode,
    taskCodePart: codePartOf(entry.task.taskCode),
    requiredSkill: entry.task.requiredSkill,
    userId: entry.userId,
    userName: entry.user.displayName,
    userSkill: entry.user.skill,
    date: toDateString(entry.date),
    hours: entry.hours,
    locked: entry.locked,
  };
}

export function toApiConflict(conflict: ConflictWithRelations): ApiConflict {
  return {
    id: conflict.id,
    type: conflict.type,
    title: conflict.title,
    description: conflict.description,
    severity: conflict.severity,
    projectId: conflict.projectId,
    projectName: conflict.project?.name ?? null,
    taskId: conflict.taskId,
    taskCode: conflict.task ? codePartOf(conflict.task.taskCode) : null,
    employeeId: conflict.employeeId,
    employeeName: conflict.employee?.displayName ?? null,
    createdAt: conflict.createdAt.toISOString(),
  };
}

export function toApiAvailability(availability: Availability): ApiAvailability {
  return {
    id: availability.id,
    userId: availability.userId,
    date: toDateString(availability.date),
    availableHours: availability.availableHours,
  };
}

export function taskNumber(taskCode: string): number {
  return parseTaskNumber(taskCode);
}