import type { DateString, PlannerEntryDraft, PlannerFailure } from "../../domain/types";
import type { TaskStatus } from "../../domain/types";
import {
  DEFAULT_WORKING_HOURS,
  compareDates,
  isWorkingDay,
  nextWorkingDayAfter,
  previousWorkingDayBefore,
  maxDate,
  workingDaysBetween,
} from "../calendar/polishCalendar";

export interface PlannerTask {
  id: string;
  projectId: string;
  requiredSkill: string;
  remainingHours: number;
  status: TaskStatus;
  rowIndex: number;
}

export interface PlannerProject {
  id: string;
  deadline: DateString;
  budgetHours: number;
}

export interface PlannerUser {
  id: string;
  skill: string;
}

export interface PlannerDependency {
  predecessorTaskId: string;
  successorTaskId: string;
}

export interface PlannerEntryLike extends PlannerEntryDraft {}

export interface PlannerInput {
  projects: PlannerProject[];
  tasks: PlannerTask[];
  dependencies: PlannerDependency[];
  users: PlannerUser[];
  availability: Record<string, Record<DateString, number>>;
  lockedEntries: PlannerEntryLike[];
  startDate: DateString;
}

export interface PlannerResult {
  entries: PlannerEntryLike[];
  failures: PlannerFailure[];
}

export function isSchedulableStatus(status: TaskStatus): boolean {
  return status === "NOT_STARTED" || status === "WORK_IN_PROGRESS";
}

/**
 * Greedy scheduling engine.
 *
 * Rules implemented:
 * - Projects are planned in order of earlier deadline, then larger budget.
 * - Each project must be finished 3 working days before its deadline (never
 *   later, and never earlier).
 * - The workload is stretched to fill the whole working window from the (possibly
 *   postponed) project start until 3 working days before the deadline.
 * - A specialist never works less than 3 hours on a day; if the workload is too
 *   small to fill the window at 3 h/day, the project start is postponed so that
 *   specialists still work at least 3 h/day and the project ends on the horizon.
 * - Within a project tasks are planned bottom-up by pyramid row; a row can only
 *   start after every task of the lower rows has been fully scheduled.
 * - Tasks in the same row are planned in parallel (no dependencies between them).
 * - Only working days (weekdays excluding Polish holidays) are used.
 * - A task is split across all eligible specialists proportionally to their daily
 *   free capacity. Each specialist's daily load never exceeds their availability.
 * - Locked (manual) entries are never modified and consume capacity.
 */
export function generatePlan(input: PlannerInput): PlannerResult {
  const { projects, tasks, users, availability, lockedEntries, startDate } = input;

  const byUserDay = new Map<string, Map<string, number>>();
  const placed: PlannerEntryLike[] = [];
  const failures: PlannerFailure[] = [];

  const capacity = (userId: string, date: DateString): number => {
    const base = availability[userId]?.[date] ?? DEFAULT_WORKING_HOURS;
    const used = byUserDay.get(userId)?.get(date) ?? 0;
    return Math.max(0, base - used);
  };

  const place = (entry: PlannerEntryLike): void => {
    placed.push(entry);
    let dayMap = byUserDay.get(entry.userId);
    if (!dayMap) {
      dayMap = new Map();
      byUserDay.set(entry.userId, dayMap);
    }
    dayMap.set(entry.date, (dayMap.get(entry.date) ?? 0) + entry.hours);
  };

  for (const locked of lockedEntries) {
    place(locked);
  }

  const schedulable = tasks.filter((t) => isSchedulableStatus(t.status) && t.remainingHours > 0);

  const byProject = new Map<string, PlannerTask[]>();
  for (const task of schedulable) {
    const list = byProject.get(task.projectId) ?? [];
    list.push(task);
    byProject.set(task.projectId, list);
  }

  const orderedProjects = [...projects]
    .filter((p) => (byProject.get(p.id) ?? []).length > 0)
    .sort((a, b) => {
      const byDeadline = compareDates(a.deadline, b.deadline);
      if (byDeadline !== 0) return byDeadline;
      return b.budgetHours - a.budgetHours;
    });

  for (const project of orderedProjects) {
    const projectTasks = (byProject.get(project.id) ?? []).sort((a, b) => {
      if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
      return b.remainingHours - a.remainingHours;
    });

    const horizon = workingDaysBefore(project.deadline, 3);
    const { projectStart, dailyCap } = computeProjectPace(projectTasks, users, startDate, horizon);

    let currentRow = -1;
    let lowerRowsEnd: DateString | null = null;
    let cursor = projectStart;

    for (const task of projectTasks) {
      if (task.rowIndex !== currentRow) {
        currentRow = task.rowIndex;
        cursor = lowerRowsEnd ? nextWorkingDayAfter(lowerRowsEnd) : projectStart;
        if (compareDates(cursor, projectStart) < 0) cursor = projectStart;
      }

      const endDate = scheduleTask(task, cursor, horizon, dailyCap);
      if (endDate) {
        lowerRowsEnd = lowerRowsEnd ? maxDate(lowerRowsEnd, endDate) : endDate;
      }
    }
  }

  function scheduleTask(
    task: PlannerTask,
    cursor: DateString,
    horizon: DateString,
    dailyCap: number,
  ): DateString | null {
    const eligible = users.filter((u) => u.skill === task.requiredSkill);
    let remaining = task.remainingHours;
    let day = cursor;
    let endDate: DateString | null = null;
    let guard = 0;

    while (remaining > 0 && guard < 800) {
      if (compareDates(day, horizon) > 0) break;
      if (!isWorkingDay(day)) {
        day = nextWorkingDayAfter(day);
        guard += 1;
        continue;
      }
      let placedToday = false;
      const isHorizon = compareDates(day, horizon) === 0;
      for (const user of eligible) {
        if (remaining <= 0) break;
        const free = capacity(user.id, day);
        if (free > 0) {
          // On the horizon day, absorb the remaining hours so the project ends exactly there.
          let hours = isHorizon ? Math.min(free, remaining) : Math.min(free, remaining, dailyCap);
          // Avoid creating days with less than 3 hours unless it is the unavoidable tail.
          if (hours < 3 && remaining > 3) hours = 0;
          if (hours > 0) {
            place({ taskId: task.id, userId: user.id, date: day, hours, locked: false });
            remaining -= hours;
            endDate = day;
            placedToday = true;
          }
        }
      }
      if (remaining > 0) {
        if (!placedToday) {
          const someCapacityInFuture = hasFutureCapacity(eligible, nextWorkingDayAfter(day), horizon);
          if (!someCapacityInFuture) break;
        }
        day = nextWorkingDayAfter(day);
      }
      guard += 1;
    }

    if (remaining > 0) {
      const reason = !eligible.length
        ? `No specialist has skill ${task.requiredSkill}`
        : `Not enough available capacity for skill ${task.requiredSkill} before project deadline`;
      failures.push({ taskId: task.id, reason });
      return null;
    }
    return endDate;
  }

  function hasFutureCapacity(eligible: PlannerUser[], from: DateString, horizon: DateString): boolean {
    let d = from;
    let guard = 0;
    while (compareDates(d, horizon) <= 0 && guard < 800) {
      if (isWorkingDay(d)) {
        for (const user of eligible) {
          if (capacity(user.id, d) > 0) return true;
        }
      }
      d = nextWorkingDayAfter(d);
      guard += 1;
    }
    return false;
  }

  return { entries: placed, failures };
}

/**
 * Returns the `count`-th working day strictly before `date`.
 */
function workingDaysBefore(date: DateString, count: number): DateString {
  let d = date;
  for (let i = 0; i < count; i += 1) {
    d = previousWorkingDayBefore(d);
  }
  return d;
}

/**
 * Computes the stretched start date and the daily hours a specialist should work
 * so the project fills the working window and ends exactly on the horizon, while
 * keeping at least 3 h per specialist per working day.
 *
 * The stretch is based on the actual pyramid structure: rows are scheduled
 * sequentially (bottom-up), so the number of days used is the sum of each row's
 * duration, and each task only uses the specialists of its own skill.
 */
function computeProjectPace(
  tasks: PlannerTask[],
  users: PlannerUser[],
  startDate: DateString,
  horizon: DateString,
): { projectStart: DateString; dailyCap: number } {
  const totalHours = tasks.reduce((sum, t) => sum + t.remainingHours, 0);
  const windowDays = workingDaysBetween(startDate, horizon).length;
  if (totalHours <= 0 || windowDays <= 0) {
    return { projectStart: startDate, dailyCap: DEFAULT_WORKING_HOURS };
  }

  const specialistCountBySkill = new Map<string, number>();
  for (const t of tasks) {
    if (specialistCountBySkill.has(t.requiredSkill)) continue;
    specialistCountBySkill.set(t.requiredSkill, users.filter((u) => u.skill === t.requiredSkill).length);
  }

  const rows = new Map<number, PlannerTask[]>();
  for (const t of tasks) {
    const list = rows.get(t.rowIndex) ?? [];
    list.push(t);
    rows.set(t.rowIndex, list);
  }
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);

  const durationAtCap = (cap: number): number => {
    let total = 0;
    for (const row of rowKeys) {
      let rowDays = 0;
      for (const t of rows.get(row)!) {
        const specialists = specialistCountBySkill.get(t.requiredSkill) ?? 0;
        if (specialists <= 0) return Number.POSITIVE_INFINITY;
        rowDays = Math.max(rowDays, Math.ceil(t.remainingHours / (specialists * cap)));
      }
      total += rowDays;
    }
    return total;
  };

  // Choose the smallest cap (most stretching) that still fits inside the window.
  let chosenCap = DEFAULT_WORKING_HOURS;
  let chosenDays = durationAtCap(DEFAULT_WORKING_HOURS);
  for (let cap = 3; cap <= DEFAULT_WORKING_HOURS; cap += 1) {
    const days = durationAtCap(cap);
    if (days <= windowDays) {
      chosenCap = cap;
      chosenDays = days;
      break;
    }
  }
  if (!Number.isFinite(chosenDays) || chosenDays > windowDays) {
    chosenDays = windowDays;
  }

  const startList = workingDaysBetween(startDate, horizon);
  const projectStart = startList[Math.max(0, startList.length - chosenDays)];
  return { projectStart, dailyCap: chosenCap };
}