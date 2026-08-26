import type { DateString, ConflictDraft } from "../../domain/types";
import type { TaskStatus } from "../../domain/types";
import {
  DEFAULT_WORKING_HOURS,
  compareDates,
  isWorkingDay,
  lastWorkingDayBefore,
  nextWorkingDayAfter,
  workingDayDistance,
} from "../calendar/polishCalendar";

export interface ConflictTask {
  id: string;
  projectId: string;
  codePart: string;
  requiredSkill: string;
  estimatedHours: number;
  remainingHours: number;
  status: TaskStatus;
  taskDeadline: DateString | null;
  rowIndex: number;
}

export interface ConflictProject {
  id: string;
  name: string;
  deadline: DateString;
  budgetHours: number;
}

export interface ConflictUser {
  id: string;
  displayName: string;
  skill: string | null;
}

export interface ConflictDependency {
  predecessorTaskId: string;
  successorTaskId: string;
}

export interface ConflictEntry {
  taskId: string;
  userId: string;
  date: DateString;
  hours: number;
}

export interface ConflictInput {
  projects: ConflictProject[];
  tasks: ConflictTask[];
  dependencies: ConflictDependency[];
  users: ConflictUser[];
  entries: ConflictEntry[];
  availability: Record<string, Record<DateString, number>>;
  today: DateString;
}

export function detectConflicts(input: ConflictInput): ConflictDraft[] {
  const conflicts: ConflictDraft[] = [];
  const { projects, tasks, dependencies, users, entries, availability, today } = input;

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const entriesByTask = new Map<string, ConflictEntry[]>();
  const entriesByUserDay = new Map<string, Map<DateString, number>>();
  for (const entry of entries) {
    const list = entriesByTask.get(entry.taskId) ?? [];
    list.push(entry);
    entriesByTask.set(entry.taskId, list);

    let dayMap = entriesByUserDay.get(entry.userId);
    if (!dayMap) {
      dayMap = new Map();
      entriesByUserDay.set(entry.userId, dayMap);
    }
    dayMap.set(entry.date, (dayMap.get(entry.date) ?? 0) + entry.hours);
  }

  const taskEntryDates = (taskId: string): DateString[] =>
    (entriesByTask.get(taskId) ?? []).map((e) => e.date).sort();

  const codeOf = (taskId: string): string => taskById.get(taskId)?.codePart ?? taskId;

  const maxEntryDate = (taskId: string): DateString | null => {
    const dates = taskEntryDates(taskId);
    return dates.length ? dates[dates.length - 1] : null;
  };

  const minEntryDate = (taskId: string): DateString | null => {
    const dates = taskEntryDates(taskId);
    return dates.length ? dates[0] : null;
  };

  const taskScheduledHours = (taskId: string): number =>
    (entriesByTask.get(taskId) ?? []).reduce((sum, e) => sum + e.hours, 0);

  const taskIsComplete = (task: ConflictTask): boolean =>
    task.status === "DONE" || task.remainingHours <= 0;

  // 1. Project budget
  for (const project of projects) {
    const totalEstimated = tasks
      .filter((t) => t.projectId === project.id)
      .reduce((sum, t) => sum + t.estimatedHours, 0);
    if (totalEstimated > project.budgetHours) {
      conflicts.push({
        type: "PROJECT_BUDGET",
        title: "Project budget exceeded",
        description: `Sum of task estimated hours (${totalEstimated}h) exceeds the project budget of ${project.budgetHours}h.`,
        severity: "WARNING",
        projectId: project.id,
        taskId: null,
        employeeId: null,
      });
    }
  }

  // 1b. Unused budget: if the plan does not use the whole project budget it is a conflict.
  for (const project of projects) {
    const planned = entries
      .filter((e) => taskById.get(e.taskId)?.projectId === project.id)
      .reduce((sum, e) => sum + e.hours, 0);
    if (planned < project.budgetHours) {
      conflicts.push({
        type: "UNUSED_BUDGET",
        title: "Unused budget",
        description: `Project ${project.name} uses ${planned}h of its ${project.budgetHours}h budget; ${project.budgetHours - planned}h remain unused.`,
        severity: "WARNING",
        projectId: project.id,
        taskId: null,
        employeeId: null,
      });
    }
  }

  // 2. Project deadline
  for (const project of projects) {
    const projectTasks = tasks.filter((t) => t.projectId === project.id);
    const remaining = projectTasks.reduce((sum, t) => sum + t.remainingHours, 0);
    if (remaining <= 0) continue;
    const horizon = lastWorkingDayBefore(project.deadline);
    const lastEntry = projectTasks
      .map((t) => maxEntryDate(t.id))
      .filter((d): d is DateString => d !== null)
      .sort()
      .pop();
    const daysLeft = workingDayDistance(today, horizon);
    let severity: "WARNING" | "ERROR" | "CRITICAL";
    if (compareDates(horizon, today) < 0) severity = "CRITICAL";
    else if (lastEntry && compareDates(lastEntry, horizon) >= 0) severity = "ERROR";
    else if (daysLeft <= 5) severity = "ERROR";
    else severity = "WARNING";
    conflicts.push({
      type: "PROJECT_DEADLINE",
      title: "Project deadline at risk",
      description: `Project "${project.name}" has ${remaining}h of remaining work that is not fully planned before its deadline.`,
      severity,
      projectId: project.id,
      taskId: null,
      employeeId: null,
    });
  }

  // 3. No available employee
  for (const task of tasks) {
    if (task.status === "DONE" || task.remainingHours <= 0) continue;
    const eligible = users.filter((u) => u.skill === task.requiredSkill);
    const scheduled = taskScheduledHours(task.id);
    const hasEntries = scheduled > 0;
    if (!hasEntries && eligible.length === 0) {
      conflicts.push({
        type: "NO_AVAILABLE_EMPLOYEE",
        title: "No available employee",
        description: `No specialist with skill ${task.requiredSkill} exists for task ${task.id} and the task has no scheduled work.`,
        severity: "ERROR",
        projectId: task.projectId,
        taskId: task.id,
        employeeId: null,
      });
      continue;
    }
    if (!hasEntries && eligible.length > 0) {
      const horizon = lastWorkingDayBefore(projectById.get(task.projectId)?.deadline ?? today);
      const hasCapacity = eligible.some((u) => hasAnyCapacity(u.id, today, horizon));
      if (!hasCapacity) {
        conflicts.push({
          type: "NO_AVAILABLE_EMPLOYEE",
          title: "No available employee",
          description: `No specialist with skill ${task.requiredSkill} has free capacity before the project deadline.`,
          severity: "ERROR",
          projectId: task.projectId,
          taskId: task.id,
          employeeId: null,
        });
      }
    }
  }

  function hasAnyCapacity(userId: string, from: DateString, horizon: DateString): boolean {
    let d = from;
    let guard = 0;
    while (compareDates(d, horizon) <= 0 && guard < 800) {
      if (isWorkingDay(d)) {
        const base = availability[userId]?.[d] ?? DEFAULT_WORKING_HOURS;
        const used = entriesByUserDay.get(userId)?.get(d) ?? 0;
        if (base - used > 0) return true;
      }
      d = nextWorkingDayAfter(d);
      guard += 1;
    }
    return false;
  }

  // 4. Dependency violations
  const cycle = findCycle(dependencies);
  if (cycle.length > 0) {
    const labels = cycle.map((id) => codeOf(id)).join(" -> ");
    conflicts.push({
      type: "DEPENDENCY_VIOLATION",
      title: "Cyclic task dependency detected",
      description: `The dependency graph contains a cycle: ${labels}.`,
      severity: "ERROR",
      projectId: null,
      taskId: cycle[0] ?? null,
      employeeId: null,
    });
  }

  for (const dep of dependencies) {
    const pred = taskById.get(dep.predecessorTaskId);
    const succ = taskById.get(dep.successorTaskId);
    if (!pred || !succ) continue;
    if (taskIsComplete(pred)) continue;
    const succMin = minEntryDate(succ.id);
    const predMax = maxEntryDate(pred.id);
    const predScheduled = taskScheduledHours(pred.id);
    if (predScheduled <= 0) continue;
    if (succMin && predMax && compareDates(succMin, predMax) <= 0) {
      conflicts.push({
        type: "DEPENDENCY_VIOLATION",
        title: "Unsatisfied task dependency",
        description: `Task ${codeOf(succ.id)} is scheduled to start (${succMin}) before its predecessor ${codeOf(pred.id)} is finished (${predMax}).`,
        severity: "ERROR",
        projectId: succ.projectId,
        taskId: succ.id,
        employeeId: null,
      });
    } else if (succMin && predMax && compareDates(succMin, predMax) > 0) {
      const predRemaining = pred.remainingHours;
      const predPlanned = predScheduled;
      if (predRemaining > predPlanned) {
        conflicts.push({
          type: "DEPENDENCY_VIOLATION",
          title: "Unsatisfied task dependency",
          description: `Task ${codeOf(succ.id)} starts after its predecessor, but predecessor ${codeOf(pred.id)} is not fully scheduled.`,
          severity: "ERROR",
          projectId: succ.projectId,
          taskId: succ.id,
          employeeId: null,
        });
      }
    }
  }

  // 5. Employee overload
  for (const user of users) {
    const dayMap = entriesByUserDay.get(user.id);
    if (!dayMap) continue;
    for (const [date, planned] of dayMap) {
      const available = availability[user.id]?.[date] ?? DEFAULT_WORKING_HOURS;
      if (planned > available) {
        conflicts.push({
          type: "EMPLOYEE_OVERLOAD",
          title: "Employee overload",
          description: `${user.displayName} is planned for ${planned}h on ${date} but is available for only ${available}h.`,
          severity: "ERROR",
          projectId: null,
          taskId: null,
          employeeId: user.id,
        });
      }
    }
  }

  // 5b. Pyramid row order: a task in row N may only be planned to dates after
  // all tasks in lower rows of the same project have been scheduled.
  for (const task of tasks) {
    const upperMin = minEntryDate(task.id);
    if (!upperMin) continue;
    const lowerTasks = tasks.filter(
      (t) => t.projectId === task.projectId && t.rowIndex < task.rowIndex && !taskIsComplete(t),
    );
    if (lowerTasks.length === 0) continue;
    const lowerMaxDates = lowerTasks
      .map((t) => maxEntryDate(t.id))
      .filter((d): d is DateString => d !== null)
      .sort();
    const lowerMax = lowerMaxDates.length ? lowerMaxDates[lowerMaxDates.length - 1] : null;
    if (lowerMax && compareDates(upperMin, lowerMax) <= 0) {
      conflicts.push({
        type: "ROW_ORDER",
        title: "Pyramid row order violated",
        description: `Task ${codeOf(task.id)} (row ${task.rowIndex}) is planned to start on ${upperMin}, before lower pyramid rows are finished (last lower-row work on ${lowerMax}).`,
        severity: "ERROR",
        projectId: task.projectId,
        taskId: task.id,
        employeeId: null,
      });
      continue;
    }
    const notFullyScheduled = lowerTasks.some((t) => t.remainingHours > taskScheduledHours(t.id));
    if (notFullyScheduled) {
      conflicts.push({
        type: "ROW_ORDER",
        title: "Pyramid row order violated",
        description: `Task ${codeOf(task.id)} (row ${task.rowIndex}) is scheduled to start after lower pyramid rows end, but some lower-row tasks are not fully scheduled.`,
        severity: "ERROR",
        projectId: task.projectId,
        taskId: task.id,
        employeeId: null,
      });
    }
  }

  // 6. Task deadline (informational)
  for (const task of tasks) {
    if (task.status === "DONE" || task.remainingHours <= 0) continue;
    if (task.taskDeadline) {
      const last = maxEntryDate(task.id);
      if (last && compareDates(last, task.taskDeadline) > 0) {
        conflicts.push({
          type: "TASK_DEADLINE",
          title: "Task deadline missed",
          description: `Task ${codeOf(task.id)} is planned to finish on ${last}, after its deadline ${task.taskDeadline}.`,
          severity: "WARNING",
          projectId: task.projectId,
          taskId: task.id,
          employeeId: null,
        });
      }
    }
    if (task.status === "ON_HOLD" && task.remainingHours > 0) {
      conflicts.push({
        type: "TASK_DEADLINE",
        title: "On-hold task deadline risk",
        description: `Task ${codeOf(task.id)} is on hold with ${task.remainingHours}h remaining; the project deadline may be affected.`,
        severity: "WARNING",
        projectId: task.projectId,
        taskId: task.id,
        employeeId: null,
      });
    }
  }

  void userById;
  return conflicts;
}

function findCycle(dependencies: ConflictDependency[]): string[] {
  const graph = new Map<string, string[]>();
  for (const dep of dependencies) {
    const list = graph.get(dep.predecessorTaskId) ?? [];
    list.push(dep.successorTaskId);
    graph.set(dep.predecessorTaskId, list);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const result: string[] = [];
  let found = false;

  const visit = (node: string): void => {
    if (found) return;
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const s = state.get(next);
      if (s === 1) {
        const idx = stack.indexOf(next);
        for (let i = idx; i < stack.length; i += 1) result.push(stack[i]);
        result.push(next);
        found = true;
        return;
      }
      if (s === undefined) visit(next);
      if (found) return;
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of graph.keys()) {
    if (state.get(node) === undefined) visit(node);
    if (found) break;
  }
  return result;
}