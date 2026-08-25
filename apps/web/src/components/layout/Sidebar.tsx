import type { ViewKey } from "../../domain/types";
import { useAppState } from "../../store/AppStateContext";
import styles from "./layout.module.css";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
}

const PM_NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "▦" },
  { key: "projects", label: "Projects", icon: "▤" },
  { key: "tasks", label: "Tasks", icon: "☑" },
  { key: "dependencies", label: "Dependencies", icon: "◮" },
  { key: "team", label: "Team", icon: "☺" },
  { key: "planner", label: "Planner", icon: "▦" },
  { key: "availability", label: "Availability", icon: "◔" },
  { key: "kanban", label: "Kanban", icon: "▤" },
  { key: "gantt", label: "Gantt", icon: "▥" },
  { key: "conflicts", label: "Conflicts", icon: "!" },
  { key: "versions", label: "Versions", icon: "⟲" },
];

const SPECIALIST_NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "▦" },
  { key: "myTasks", label: "My Tasks", icon: "☑" },
  { key: "team", label: "Team", icon: "☺" },
  { key: "planner", label: "Planner", icon: "▦" },
  { key: "availability", label: "Availability", icon: "◔" },
  { key: "kanban", label: "Kanban", icon: "▤" },
  { key: "gantt", label: "Gantt", icon: "▥" },
];

export function Sidebar() {
  const { user, view, setView, logout } = useAppState();
  const isPM = user?.role === "PROJECT_MANAGER";
  const nav = isPM ? PM_NAV : SPECIALIST_NAV;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>E</span>
        <div>
          <strong>Engineering</strong>
          <span className={styles.brandSub}>Resource Planner</span>
        </div>
      </div>
      <nav className={styles.nav}>
        {nav.map((item) => (
          <button
            key={item.key}
            className={`${styles.navItem} ${view === item.key ? styles.navItemActive : ""}`}
            onClick={() => setView(item.key)}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className={styles.sidebarFooter}>
        <span className={styles.userBadge}>{user?.displayName}</span>
        <button className={styles.logout} onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </aside>
  );
}