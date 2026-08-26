import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  AppData,
  DateString,
  PlannerSummary,
  SkillType,
  TaskStatus,
  ViewKey,
} from "../domain/types";
import { STORAGE_KEYS } from "../domain/constants";
import { api } from "../services/api";
import { warsawToday } from "../utils/date";

export interface AppStateContextValue {
  data: AppData | null;
  user: AppData["user"] | null;
  view: ViewKey;
  setView: (view: ViewKey) => void;
  selectedWeekStart: DateString;
  setSelectedWeekStart: (date: DateString) => void;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  createSpecialist: (input: { displayName: string; skill: SkillType }) => Promise<void>;
  updateSpecialist: (id: string, input: { displayName: string; skill: SkillType }) => Promise<void>;
  deleteSpecialist: (id: string) => Promise<void>;
  createProject: (input: { name: string; deadline: DateString; budgetHours: number }) => Promise<void>;
  updateProject: (id: string, input: Partial<{ name: string; deadline: DateString; budgetHours: number }>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  savePyramid: (projectId: string, rows: string[][]) => Promise<void>;
  createTask: (input: { projectId: string; name: string; requiredSkill: string; estimatedHours: number; taskDeadline?: DateString | null }) => Promise<void>;
  updateTask: (id: string, input: Partial<{ name: string; estimatedHours: number; taskDeadline: DateString | null; requiredSkill: string }>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  updateTaskStatus: (id: string, status: TaskStatus, actualWorkedHours?: number) => Promise<void>;
  updateTaskUserStatus: (id: string, userId: string, status: TaskStatus) => Promise<void>;
  assignTask: (taskId: string, assignments: Array<{ userId: string; date: DateString; hours: number }>) => Promise<void>;
  removeAssignment: (taskId: string, userId: string) => Promise<void>;
  updatePlanEntry: (id: string, input: { userId?: string; date?: DateString; hours?: number }) => Promise<void>;
  setPlanEntryLock: (id: string, locked: boolean) => Promise<void>;
  deletePlanEntry: (id: string) => Promise<void>;
  upsertAvailability: (userId: string, startDate: DateString, endDate: DateString, hours: number) => Promise<void>;
  deleteAvailability: (userId: string, date: DateString) => Promise<void>;
  generatePlan: () => Promise<PlannerSummary>;
  planNotice: PlannerSummary | null;
  resetDatabase: () => Promise<void>;
  wipeAll: () => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

function readLastView(): ViewKey {
  const stored = localStorage.getItem(STORAGE_KEYS.lastView) as ViewKey | null;
  return stored ?? "dashboard";
}

function readSelectedWeek(): DateString {
  const stored = localStorage.getItem(STORAGE_KEYS.selectedWeek);
  return stored ?? warsawToday();
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [view, setViewState] = useState<ViewKey>(() => readLastView());
  const [selectedWeekStart, setSelectedWeekStartState] = useState<DateString>(() => readSelectedWeek());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planNotice, setPlanNotice] = useState<PlannerSummary | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await api.getAppData();
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setView = useCallback((next: ViewKey) => {
    setViewState(next);
    localStorage.setItem(STORAGE_KEYS.lastView, next);
  }, []);

  const setSelectedWeekStart = useCallback((date: DateString) => {
    setSelectedWeekStartState(date);
    localStorage.setItem(STORAGE_KEYS.selectedWeek, date);
  }, []);

  const login = useCallback(
    async (loginName: string, password: string) => {
      await api.login(loginName, password);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Always sign out locally even if the server request fails.
    }
    setData(null);
  }, []);

  const run = useCallback(
    async (operation: () => Promise<unknown>) => {
      await operation();
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<AppStateContextValue>(
    () => ({
      data,
      user: data?.user ?? null,
      view,
      setView,
      selectedWeekStart,
      setSelectedWeekStart,
      loading,
      refreshing,
      error,
      login,
      logout,
      refresh,
      createSpecialist: (input) => run(() => api.createSpecialist(input)),
      updateSpecialist: (id, input) => run(() => api.updateSpecialist(id, input)),
      deleteSpecialist: (id) => run(() => api.deleteSpecialist(id)),
      createProject: (input) => run(() => api.createProject(input)),
      updateProject: (id, input) => run(() => api.updateProject(id, input)),
      deleteProject: (id) => run(() => api.deleteProject(id)),
      savePyramid: (projectId, rows) => run(() => api.savePyramid(projectId, rows)),
      createTask: (input) => run(() => api.createTask(input)),
      updateTask: (id, input) => run(() => api.updateTask(id, input)),
      deleteTask: (id) => run(() => api.deleteTask(id)),
      updateTaskStatus: (id, status, actualWorkedHours) => run(() => api.updateTaskStatus(id, status, actualWorkedHours)),
      updateTaskUserStatus: (id, userId, status) => run(() => api.updateTaskUserStatus(id, userId, status)),
      assignTask: (taskId, assignments) => run(() => api.assignTask(taskId, assignments)),
      removeAssignment: (taskId, userId) => run(() => api.removeAssignment(taskId, userId)),
      updatePlanEntry: (id, input) => run(() => api.updatePlanEntry(id, input)),
      setPlanEntryLock: (id, locked) => run(() => api.setPlanEntryLock(id, locked)),
      deletePlanEntry: (id) => run(() => api.deletePlanEntry(id)),
      upsertAvailability: (userId, startDate, endDate, hours) =>
        run(() => api.upsertAvailability(userId, startDate, endDate, hours)),
      deleteAvailability: (userId, date) => run(() => api.deleteAvailability(userId, date)),
      generatePlan: async () => {
        const summary = await api.generatePlan();
        await refresh();
        setPlanNotice(summary);
        return summary;
      },
      planNotice,
      resetDatabase: () => run(() => api.resetDatabase()),
      wipeAll: () => run(() => api.wipeAll()),
    }),
    [data, view, selectedWeekStart, loading, refreshing, error, login, logout, refresh, run, setView, setSelectedWeekStart, planNotice],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return ctx;
}
