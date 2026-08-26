import { useMemo } from "react";
import { useAppState } from "../store/AppStateContext";
import { Card, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/Extras";
import type { ApiTask, DateString } from "../domain/types";
import { parseDateString, formatDDMMYYYY } from "../utils/date";
import styles from "./pages.module.css";

interface GanttDayBox {
  date: DateString;
  hours: number;
  locked: boolean;
}

interface GanttRow {
  task: ApiTask;
  code: string;
  days: GanttDayBox[];
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function GanttPage() {
  const { data } = useAppState();

  const { rows, globalStart, globalEnd, totalDays } = useMemo(() => {
    if (!data) return { rows: [], globalStart: "", globalEnd: "", totalDays: 0 };

    const specialists = data.team.filter((m) => m.role === "SPECIALIST");

    const entriesByTaskUser = new Map<string, Array<{ date: string; hours: number; locked: boolean }>>();
    for (const e of data.planEntries) {
      const key = `${e.taskId}|${e.userId}`;
      const list = entriesByTaskUser.get(key) ?? [];
      list.push({ date: e.date, hours: e.hours, locked: e.locked });
      entriesByTaskUser.set(key, list);
    }

    const rows: GanttRow[] = [];
    for (const task of data.tasks) {
      const parts = task.codePart.split("-");
      for (const spec of specialists.filter((s) => s.skill === task.requiredSkill)) {
        const days = (entriesByTaskUser.get(`${task.id}|${spec.id}`) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
        const code = parts.length >= 3 ? `${parts[0]}-${spec.login.toUpperCase()}-${parts[2]}` : task.codePart;
        rows.push({ task, code, days });
      }
    }

    const deadlineDates = data.projects.map((p) => p.deadline);
    const assignedDates = rows.flatMap((r) => r.days.map((d) => d.date));
    const allDates = [...deadlineDates, ...assignedDates].filter(Boolean);
    if (allDates.length === 0) return { rows, globalStart: "", globalEnd: "", totalDays: 0 };

    const sorted = allDates.slice().sort();
    const gs = sorted[0];
    const ge = sorted[sorted.length - 1];
    return {
      rows,
      globalStart: gs,
      globalEnd: ge,
      totalDays: Math.max(1, dayDiff(parseDateString(gs), parseDateString(ge)) + 1),
    };
  }, [data]);

  if (!data) return null;

  const weeks = useMemo(() => {
    if (!globalStart || !globalEnd) return [];
    const out: Array<{ num: number; leftPct: number; widthPct: number }> = [];
    const gs = parseDateString(globalStart);
    const endDate = parseDateString(globalEnd);
    let d = new Date(gs.getTime());
    let currentWeek = isoWeekNumber(d);
    let weekStart = new Date(d.getTime());
    while (d <= endDate) {
      const w = isoWeekNumber(d);
      if (w !== currentWeek) {
        const weekEnd = new Date(d.getTime() - 86400000);
        out.push({
          num: currentWeek,
          leftPct: (dayDiff(gs, weekStart) / totalDays) * 100,
          widthPct: ((dayDiff(weekStart, weekEnd) + 1) / totalDays) * 100,
        });
        currentWeek = w;
        weekStart = new Date(d.getTime());
      }
      d = new Date(d.getTime() + 86400000);
    }
    out.push({
      num: currentWeek,
      leftPct: (dayDiff(gs, weekStart) / totalDays) * 100,
      widthPct: ((dayDiff(weekStart, endDate) + 1) / totalDays) * 100,
    });
    return out;
  }, [globalStart, globalEnd, totalDays]);

  const months = useMemo(() => {
    if (!globalStart || !globalEnd) return [];
    const out: Array<{ label: string; leftPct: number; widthPct: number }> = [];
    const gs = parseDateString(globalStart);
    let d = new Date(gs.getFullYear(), gs.getMonth(), 1);
    const endDate = parseDateString(globalEnd);
    while (d <= endDate) {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const monthEnd = next > endDate ? endDate : new Date(next.getTime() - 86400000);
      const left = dayDiff(gs, d);
      const width = dayDiff(d, monthEnd) + 1;
      out.push({
        label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        leftPct: (left / totalDays) * 100,
        widthPct: (width / totalDays) * 100,
      });
      d = next;
    }
    return out;
  }, [globalStart, globalEnd, totalDays]);

  return (
    <div>
      <p className="page-subtitle">
        Gantt chart for all tasks across all the projects period ({globalStart} → {globalEnd}).
      </p>
      {data.projects.length === 0 ? (
        <Card>
          <EmptyState title="No projects" hint="Create a project first, then add tasks to see the Gantt chart." />
        </Card>
      ) : (
        data.projects.map((project) => {
          const projectRows = rows.filter((r) => r.task.projectId === project.id);
          return (
            <Card key={project.id} className="mb-16">
              <CardHeader title={`${project.code} — ${project.name}`} subtitle={`${projectRows.length} specialist rows`} />
              <div className={styles.gantt}>
                <div className={styles.ganttHeader}>
                  <div className={styles.ganttLabelCol}>
                    <div className={styles.ganttAxisLabel}>Month</div>
                    <div className={styles.ganttAxisLabel}>Week number</div>
                  </div>
                  <div className={styles.ganttTimelineHeader}>
                    <div className={styles.ganttMonthRow}>
                      {months.map((m, i) => (
                        <div key={i} className={styles.ganttMonth} style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}>
                          {m.label}
                        </div>
                      ))}
                    </div>
                    <div className={styles.ganttWeekRow}>
                      {weeks.map((w, i) => (
                        <div key={i} className={styles.ganttWeek} style={{ left: `${w.leftPct}%`, width: `${w.widthPct}%` }}>
                          {w.num}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {projectRows.map(({ task, code, days }) => {
                  return (
                    <div key={`${task.id}|${code}`} className={styles.ganttRow}>
                      <div className={styles.ganttLabelCol}>
                        <span className={styles.kanbanCardCode}>
                          <span className={styles.kanbanCardCodeLine}>{code}</span>
                          {task.name ? <span className="muted">({task.name})</span> : null}
                        </span>
                        <Badge tone="blue">{task.requiredSkill}</Badge>
                      </div>
                      <div className={styles.ganttTimeline}>
                        {days.map((d) => {
                          const left = dayDiff(parseDateString(globalStart), parseDateString(d.date));
                          const height = Math.round(6 + d.hours * 3);
                          return (
                            <div
                              key={`${task.id}|${code}|${d.date}`}
                              className={`${styles.ganttBar} ${d.locked ? styles.ganttBarLocked : styles.ganttBarAuto}`}
                              style={{
                                left: `${(left / totalDays) * 100}%`,
                                width: `${(1 / totalDays) * 100}%`,
                                height,
                              }}
                              title={`${code} · ${formatDDMMYYYY(d.date)} · ${d.hours}h · ${d.locked ? "manual" : "auto"}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

