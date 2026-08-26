import type {
  ApiAvailability,
  ApiConflict,
  ApiPlanEntry,
  ApiProject,
  ApiTask,
  ApiUser,
  ApiVersionDetail,
  DateString,
  PlannerSummary,
  TaskStatus,
} from "../domain/types";

const BASE =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.PROD ? "https://engineering-resource-planner.onrender.com/api" : "/api");

export class ApiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Covers cold-start wake-up windows on free hosts (Render sleeps after ~15 min idle).
const TRANSIENT_RETRY_DELAYS_MS = [3000, 5000, 8000, 12000, 20000];

function isTransientStatus(status: number): boolean {
  return status === 0 || (status >= 500 && status < 600);
}

function looksLikeWakePage(response: Response): boolean {
  const ct = response.headers.get("content-type") ?? "";
  return !ct.includes("application/json");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, options: RequestInit = {}, attempt = 0): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const method = (options.method ?? "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  const delays = TRANSIENT_RETRY_DELAYS_MS;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    if (canRetry && attempt < delays.length) {
      await delay(delays[attempt]);
      return request<T>(path, options, attempt + 1);
    }
    throw new ApiError("Network error — the server may be starting up. Try again in a moment.", 0);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await safeJson<{ error?: string }>(response);
      if (body?.error) message = body.error;
    } catch {
      // ignore parse errors
    }
    if (canRetry && isTransientStatus(response.status) && attempt < delays.length) {
      await delay(delays[attempt]);
      return request<T>(path, options, attempt + 1);
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  try {
    return await safeJson<T>(response);
  } catch {
    // A 2xx with non-JSON body is almost always the cold-start wake-up HTML page.
    // Retry quietly so the app recovers on its own once the server is ready.
    if (canRetry && attempt < delays.length) {
      await delay(delays[attempt]);
      return request<T>(path, options, attempt + 1);
    }
    if (looksLikeWakePage(response)) {
      throw new ApiError(
        "The server is still warming up. Please wait a few seconds and refresh the page.",
        response.status,
      );
    }
    throw new ApiError(`Invalid response (${response.status}): server returned non-JSON data`, response.status);
  }
}

async function safeJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return JSON.parse(text) as T;
}

export interface LoginResponse {
  user: ApiUser;
}

export const api = {
  login: (login: string, password: string) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify({ login, password }) }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST", body: JSON.stringify({}) }),

  me: () => request<{ user: ApiUser }>("/auth/me"),

  getAppData: () => request<import("../domain/types").AppData>("/app-data"),

  createSpecialist: (input: { displayName: string; skill: import("../domain/types").SkillType }) =>
    request<import("../domain/types").ApiUser>("/team", { method: "POST", body: JSON.stringify(input) }),

  updateSpecialist: (id: string, input: { displayName: string; skill: import("../domain/types").SkillType }) =>
    request<import("../domain/types").ApiUser>(`/team/${id}`, { method: "PUT", body: JSON.stringify(input) }),

  deleteSpecialist: (id: string) => request<{ ok: boolean }>(`/team/${id}`, { method: "DELETE" }),

  createProject: (input: { name: string; deadline: DateString; budgetHours: number }) =>
    request<ApiProject>("/projects", { method: "POST", body: JSON.stringify(input) }),

  updateProject: (id: string, input: Partial<{ name: string; deadline: DateString; budgetHours: number }>) =>
    request<ApiProject>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(input) }),

  deleteProject: (id: string) => request<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),

  savePyramid: (projectId: string, rows: string[][]) =>
    request<{ ok: boolean }>(`/projects/${projectId}/pyramid`, { method: "PUT", body: JSON.stringify({ rows }) }),

  createTask: (input: { projectId: string; name: string; requiredSkill: string; estimatedHours: number; taskDeadline?: DateString | null }) =>
    request<ApiTask>("/tasks", { method: "POST", body: JSON.stringify(input) }),

  updateTask: (id: string, input: Partial<{ name: string; estimatedHours: number; taskDeadline: DateString | null; requiredSkill: string }>) =>
    request<ApiTask>(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(input) }),

  deleteTask: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),

  updateTaskStatus: (id: string, status: TaskStatus, actualWorkedHours?: number) =>
    request<ApiTask>(`/tasks/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status, ...(actualWorkedHours !== undefined ? { actualWorkedHours } : {}) }),
    }),

  updateTaskUserStatus: (id: string, userId: string, status: TaskStatus) =>
    request<ApiTask>(`/tasks/${id}/status/user`, {
      method: "PUT",
      body: JSON.stringify({ userId, status }),
    }),

  assignTask: (taskId: string, assignments: Array<{ userId: string; date: DateString; hours: number }>) =>
    request<ApiPlanEntry[]>(`/tasks/${taskId}/assignments`, {
      method: "POST",
      body: JSON.stringify({ assignments }),
    }),

  removeAssignment: (taskId: string, userId: string) =>
    request<{ ok: boolean }>(`/tasks/${taskId}/assignments/remove`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  updatePlanEntry: (id: string, input: { userId?: string; date?: DateString; hours?: number }) =>
    request<ApiPlanEntry>(`/plan-entries/${id}`, { method: "PUT", body: JSON.stringify(input) }),

  setPlanEntryLock: (id: string, locked: boolean) =>
    request<ApiPlanEntry>(`/plan-entries/${id}/lock`, { method: "PUT", body: JSON.stringify({ locked }) }),

  deletePlanEntry: (id: string) => request<{ ok: boolean }>(`/plan-entries/${id}`, { method: "DELETE" }),

  upsertAvailability: (userId: string, startDate: DateString, endDate: DateString, availableHours: number) =>
    request<ApiAvailability[]>("/availability", {
      method: "POST",
      body: JSON.stringify({ userId, startDate, endDate, availableHours }),
    }),

  deleteAvailability: (userId: string, date: DateString) =>
    request<{ ok: boolean }>(`/availability/${userId}/${date}`, { method: "DELETE" }),

  generatePlan: () => request<PlannerSummary>("/planner/generate", { method: "POST" }),

  getConflicts: () => request<ApiConflict[]>("/conflicts"),

  getVersions: () => request<import("../domain/types").ApiVersionSummary[]>("/versions"),

  getVersion: (id: string) => request<ApiVersionDetail>(`/versions/${id}`),

  resetDatabase: () => request<{ ok: boolean }>("/admin/reset", { method: "POST" }),

  wipeAll: () => request<{ ok: boolean }>("/admin/wipe", { method: "POST" }),
};

export { BASE };
