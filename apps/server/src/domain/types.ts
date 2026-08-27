import type {
  Role,
  SkillType,
  TaskStatus,
  ConflictSeverity,
  ConflictType,
  User,
  Project,
  Task,
  TaskDependency,
  PlanEntry,
  Availability,
  Conflict,
  VersionSnapshot,
  Session,
} from "@prisma/client";

export type { Role, SkillType, TaskStatus, ConflictSeverity, ConflictType };

export type DateString = string;

export interface ApiUser {
  id: string;
  login: string;
  displayName: string;
  role: Role;
  skill: SkillType | null;
}

export interface ApiProject {
  id: string;
  code: string;
  name: string;
  deadline: DateString;
  budgetHours: number;
  createdAt: string;
  updatedAt: string;
  tasksCount: number;
  doneTasksCount: number;
  totalEstimatedHours: number;
}

export interface ApiTask {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  taskCode: string;
  name: string;
  codePart: string;
  requiredSkill: SkillType;
  estimatedHours: number;
  actualWorkedHours: number;
  remainingHours: number;
  status: TaskStatus;
  taskDeadline: DateString | null;
  rowIndex: number;
  statusByUser: Record<string, TaskStatus>;
  assignedUserIds: string[];
  assignedUsers: Array<{ id: string; displayName: string; login: string; skill: SkillType }>;
  scheduledHours: number;
}

export interface ApiDependency {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
}

export interface ApiPlanEntry {
  id: string;
  taskId: string;
  taskCode: string;
  taskCodePart: string;
  requiredSkill: SkillType;
  userId: string;
  userName: string;
  userSkill: SkillType | null;
  date: DateString;
  hours: number;
  locked: boolean;
}

export interface ApiAvailability {
  id: string;
  userId: string;
  date: DateString;
  availableHours: number;
}

export interface ApiConflict {
  id: string;
  type: ConflictType;
  title: string;
  description: string;
  severity: ConflictSeverity;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskCode: string | null;
  employeeId: string | null;
  employeeName: string | null;
  createdAt: string;
}

export interface ApiVersionSummary {
  id: string;
  snapshotDate: DateString;
  createdAt: string;
  updatedAt: string;
  planEntriesCount: number;
  conflictsCount: number;
}

export interface ApiVersionDetail extends ApiVersionSummary {
  planEntries: Array<{
    taskId: string;
    taskCode: string;
    userId: string;
    userName: string;
    date: DateString;
    hours: number;
    locked: boolean;
  }>;
  conflicts: Array<{
    type: ConflictType;
    title: string;
    description: string;
    severity: ConflictSeverity;
    projectId: string | null;
    taskId: string | null;
    employeeId: string | null;
  }>;
}

export interface ApiTeamMember {
  id: string;
  login: string;
  displayName: string;
  role: Role;
  skill: SkillType | null;
  totalAvailabilityHours: number;
  plannedHours: number;
  plannedHoursNext3Months: number;
  availableHours: number;
  availableHoursNext3Months: number;
}

export interface PlannerEntryDraft {
  taskId: string;
  userId: string;
  date: DateString;
  hours: number;
  locked: boolean;
}

export interface ConflictDraft {
  type: ConflictType;
  title: string;
  description: string;
  severity: ConflictSeverity;
  projectId: string | null;
  taskId: string | null;
  employeeId: string | null;
}

export interface PlannerFailure {
  taskId: string;
  reason: string;
}

export interface PlannerSummary {
  entriesCreated: number;
  failures: PlannerFailure[];
}

export type { User, Project, Task, TaskDependency, PlanEntry, Availability, Conflict, VersionSnapshot, Session };