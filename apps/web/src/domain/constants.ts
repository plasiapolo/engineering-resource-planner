import type { SkillType, TaskStatus } from "./types";

export const SKILL_LABELS: Record<SkillType, string> = {
  A: "A - Automation",
  B: "B - Builds & Integration",
  C: "C - Control Systems",
  E: "E - Electrical",
  P: "P - Process",
  S: "S - Software",
};

export const SKILL_SHORT_LABELS: Record<SkillType, string> = {
  A: "A",
  B: "B",
  C: "C",
  E: "E",
  P: "P",
  S: "S",
};

export const SKILL_SPECIALISTS: Record<SkillType, string[]> = {
  A: ["a1", "a2"],
  B: ["b1"],
  E: ["e1"],
  C: ["c1"],
  S: ["s1", "s2", "s3"],
  P: ["p1", "p2", "p3"],
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: "Not started",
  WORK_IN_PROGRESS: "Work in progress",
  DONE: "Done",
  ON_HOLD: "On hold",
};

export const CONFLICT_SEVERITY_LABELS = {
  INFO: "Info",
  WARNING: "Warning",
  ERROR: "Error",
  CRITICAL: "Critical",
} as const;

export const CONFLICT_TYPE_LABELS: Record<string, string> = {
  PROJECT_DEADLINE: "Project deadline",
  PROJECT_BUDGET: "Project budget",
  UNUSED_BUDGET: "Unused budget",
  NO_AVAILABLE_EMPLOYEE: "No available employee",
  DEPENDENCY_VIOLATION: "Dependency violation",
  EMPLOYEE_OVERLOAD: "Employee overload",
  TASK_DEADLINE: "Task deadline",
  ROW_ORDER: "Pyramid row order",
};

export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  NOT_STARTED: ["WORK_IN_PROGRESS"],
  WORK_IN_PROGRESS: ["ON_HOLD", "DONE"],
  ON_HOLD: ["WORK_IN_PROGRESS", "DONE"],
  DONE: ["WORK_IN_PROGRESS", "ON_HOLD"],
};

export const DEFAULT_WORKING_HOURS = 8;

export const CALENDAR_MONTHS_BACK = 3;
export const CALENDAR_MONTHS_FORWARD = 18;

export const STORAGE_KEYS = {
  lastView: "erp:lastView",
  selectedWeek: "erp:selectedWeek",
  plannerFilters: "erp:plannerFilters",
  tablePreferences: "erp:tablePrefs",
} as const;