import { useAppState } from "./store/AppStateContext";
import { AppShell } from "./components/layout/Topbar";
import { Spinner } from "./components/ui/Extras";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TasksPage } from "./pages/TasksPage";
import { DependenciesPage } from "./pages/DependenciesPage";
import { TeamPage } from "./pages/TeamPage";
import { PlannerPage } from "./pages/PlannerPage";
import { AvailabilityPage } from "./pages/AvailabilityPage";
import { KanbanPage } from "./pages/KanbanPage";
import { GanttPage } from "./pages/GanttPage";
import { ConflictsPage } from "./pages/ConflictsPage";
import { VersionsPage } from "./pages/VersionsPage";
import { SpecialistDashboardPage } from "./pages/SpecialistDashboardPage";
import { MyTasksPage } from "./pages/MyTasksPage";

const PM_PAGES = {
  dashboard: DashboardPage,
  projects: ProjectsPage,
  tasks: TasksPage,
  dependencies: DependenciesPage,
  team: TeamPage,
  planner: PlannerPage,
  availability: AvailabilityPage,
  kanban: KanbanPage,
  gantt: GanttPage,
  conflicts: ConflictsPage,
  versions: VersionsPage,
} as const;

const SPECIALIST_PAGES = {
  dashboard: SpecialistDashboardPage,
  myTasks: MyTasksPage,
  team: TeamPage,
  planner: PlannerPage,
  availability: AvailabilityPage,
  kanban: KanbanPage,
  gantt: GanttPage,
} as const;

export function App() {
  const { user, view, loading } = useAppState();

  if (loading && !user) {
    return <Spinner label="Loading application…" />;
  }

  if (!user) {
    return <LoginPage />;
  }

  const isPM = user.role === "PROJECT_MANAGER";
  if (isPM) {
    const Page = PM_PAGES[view as keyof typeof PM_PAGES] ?? DashboardPage;
    return (
      <AppShell>
        <Page />
      </AppShell>
    );
  }

  const Page = SPECIALIST_PAGES[view as keyof typeof SPECIALIST_PAGES] ?? SpecialistDashboardPage;
  return (
    <AppShell>
      <Page />
    </AppShell>
  );
}