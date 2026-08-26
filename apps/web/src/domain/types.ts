export type Role = "PROJECT_MANAGER" | "SPECIALIST";

export type SkillType = "A" | "B" | "C" | "E" | "P" | "S";

export type TaskStatus = "NOT_STARTED" | "WORK_IN_PROGRESS" | "DONE" | "ON_HOLD";

export type ConflictSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type ConflictType =
  | "PROJECT_DEADLINE"
  | "PROJECT_BUDGET"
  | "UNUSED_BUDGET"
  | "NO_AVAILABLE_EMPLOYEE"
  | "DEPENDENCY_VIOLATION"
  | "EMPLOYEE_OVERLOAD"
  | "TASK_DEADLINE"
  | "ROW_ORDER";

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

export interface ApiVersionSnapshotPlanEntry {
  taskId: string;
  taskCode: string;
  userId: string;
  userName: string;
  date: DateString;
  hours: number;
  locked: boolean;
}

export interface ApiVersionSnapshotConflict {
  type: ConflictType;
  title: string;
  description: string;
  severity: ConflictSeverity;
  projectId: string | null;
  taskId: string | null;
  employeeId: string | null;
}

export interface ApiVersionDetail extends ApiVersionSummary {
  planEntries: ApiVersionSnapshotPlanEntry[];
  conflicts: ApiVersionSnapshotConflict[];
}

export interface ApiTeamMember {
  id: string;
  login: string;
  displayName: string;
  role: Role;
  skill: SkillType | null;
  totalAvailabilityHours: number;
  plannedHours: number;
  availableHours: number;
  availableHoursNext3Months: number;
}

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

export interface PlannerSummary {
  entriesCreated: number;
  failures: Array<{ taskId: string; reason: string }>;
}

export type ViewKey =
  | "dashboard"
  | "projects"
  | "tasks"
  | "dependencies"
  | "team"
  | "planner"
  | "availability"
  | "kanban"
  | "gantt"
  | "conflicts"
  | "versions"
  | "myTasks";