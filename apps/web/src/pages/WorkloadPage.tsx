import { useMemo } from "react";
import { useAppState } from "../store/AppStateContext";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/Extras";
import type { DateString } from "../domain/types";
import { parseDateString, formatDDMMYYYY } from "../utils/date";
import styles from "./pages.module.css";

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

export function WorkloadPage() {
  const { data } = useAppState();

  const { globalStart, globalEnd, totalDays, entriesByUserProject } = useMemo(() => {
    if (!data) return { globalStart: "", globalEnd: "", totalDays: 0, entriesByUserProject: new Map<string, Map<string, Array<{ date: DateString; hours: number; locked: boolean }>>>() };

    const taskById = new Map(data.tasks.map((t) => [t.id, t]));
    const entriesByUserProject = new Map<string, Map<string, Array<{ date: DateString; hours: number; locked: boolean }>>>();
    for (const e of data.planEntries) {
      const task = taskById.get(e.taskId);
      if (!task) continue;
      const byProject = entriesByUserProject.get(e.userId) ?? new Map<string, Array<{ date: DateString; hours: number; locked: boolean }>>();
      const list = byProject.get(task.projectId) ?? [];
      list.push({ date: e.date, hours: e.hours, locked: e.locked });
      byProject.set(task.projectId, list);
      entriesByUserProject.set(e.userId, byProject);
    }

    const allDates = [
      ...data.projects.map((p) => p.deadline),
      ...data.planEntries.map((e) => e.date),
    ].filter(Boolean);
    if (allDates.length === 0) return { globalStart: "", globalEnd: "", totalDays: 0, entriesByUserProject };
    const sorted = allDates.slice().sort();
    const gs = sorted[0];
    const ge = sorted[sorted.length - 1];
    return {
      globalStart: gs,
      globalEnd: ge,
      totalDays: Math.max(1, dayDiff(parseDateString(gs), parseDateString(ge)) + 1),
      entriesByUserProject,
    };
  }, [data]);

  if (!data) return null;

  const specialists = data.team.filter((m) => m.role === "SPECIALIST");
  const projects = data.projects;

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
      out.push({
        label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        leftPct: (dayDiff(gs, d) / totalDays) * 100,
        widthPct: ((dayDiff(d, monthEnd) + 1) / totalDays) * 100,
      });
      d = next;
    }
    return out;
  }, [globalStart, globalEnd, totalDays]);

  return (
    <div>
      <p className="page-subtitle">
        Workload per specialist and project ({globalStart} → {globalEnd}). Orange boxes are manual assignments; blue are
        auto-generated. Box thickness reflects the hours worked that day.
      </p>
      {specialists.length === 0 || projects.length === 0 ? (
        <Card>
          <EmptyState title="No specialists or projects" hint="Add specialists and projects to see the workload." />
        </Card>
      ) : (
        <Card pad={false}>
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

            {specialists.map((specialist) => {
              const byProject = entriesByUserProject.get(specialist.id) ?? new Map<string, Array<{ date: DateString; hours: number; locked: boolean }>>();
              return (
                <div key={specialist.id} className={styles.workloadGroup}>
                  <div className={`${styles.ganttRow} ${styles.workloadSpecialistRow}`}>
                    <div className={styles.ganttLabelCol}>
                      <strong>{specialist.displayName}</strong>
                      <Badge tone="blue">{specialist.skill ?? "—"}</Badge>
                    </div>
                    <div className={styles.ganttTimeline} />
                  </div>
                  {projects.map((project) => {
                    const boxes = (byProject.get(project.id) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
                    return (
                      <div key={project.id} className={styles.ganttRow}>
                        <div className={styles.ganttLabelCol}>
                          <span className={styles.workloadProjectCode}>{project.code}</span>
                          <span className="muted" style={{ fontSize: 11 }}>
                            {project.name}
                          </span>
                        </div>
                        <div className={styles.ganttTimeline}>
                          {boxes.map((b) => {
                            const left = dayDiff(parseDateString(globalStart), parseDateString(b.date));
                            const height = Math.round(6 + b.hours * 3);
                            return (
                              <div
                                key={`${specialist.id}|${project.id}|${b.date}`}
                                className={`${styles.ganttBar} ${b.locked ? styles.ganttBarLocked : styles.ganttBarAuto}`}
                                style={{
                                  left: `${(left / totalDays) * 100}%`,
                                  width: `${(1 / totalDays) * 100}%`,
                                  height,
                                }}
                                title={`${specialist.login.toUpperCase()} · ${project.code} · ${formatDDMMYYYY(b.date)} · ${b.hours}h · ${b.locked ? "manual" : "auto"}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}