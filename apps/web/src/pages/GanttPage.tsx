import { useMemo } from "react";
import { useAppState } from "../store/AppStateContext";
import { Card, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/Extras";
import type { ApiTask, DateString } from "../domain/types";
import { parseDateString, formatDDMMYYYY, warsawToday } from "../utils/date";
import styles from "./pages.module.css";

interface TaskSpan {
  task: ApiTask;
  start: DateString;
  end: DateString;
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

  const { spans, globalStart, globalEnd, totalDays } = useMemo(() => {
    if (!data) return { spans: [], globalStart: "", globalEnd: "", totalDays: 0 };

    const entryDates: Record<string, string[]> = {};
    for (const e of data.planEntries) {
      (entryDates[e.taskId] ??= []).push(e.date);
    }

    const spans: TaskSpan[] = data.tasks.map((task) => {
      const dates = (entryDates[task.id] ?? []).slice().sort();
      const start = dates[0] ?? data.projects.find((p) => p.id === task.projectId)?.deadline ?? warsawToday();
      const end = dates[dates.length - 1] ?? start;
      return { task, start, end: end < start ? start : end };
    });

    const deadlineDates = data.projects.map((p) => p.deadline);
    const allDates = [...deadlineDates, ...spans.map((s) => s.start), ...spans.map((s) => s.end)].filter(Boolean);
    if (allDates.length === 0) return { spans: [], globalStart: "", globalEnd: "", totalDays: 0 };

    const sorted = allDates.slice().sort();
    const gs = sorted[0];
    const ge = sorted[sorted.length - 1];
    return {
      spans,
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
        label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
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
        Gantt chart for all tasks across the whole project period ({globalStart} → {globalEnd}).
      </p>
      {data.projects.length === 0 ? (
        <Card>
          <EmptyState title="No projects" hint="Create a project first, then add tasks to see the Gantt chart." />
        </Card>
      ) : (
        data.projects.map((project) => {
          const projectSpans = spans.filter((s) => s.task.projectId === project.id);
          return (
            <Card key={project.id} className="mb-16">
              <CardHeader title={`${project.code} — ${project.name}`} subtitle={`${projectSpans.length} tasks`} />
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
                {projectSpans.map(({ task, start, end }) => {
                  const left = dayDiff(parseDateString(globalStart), parseDateString(start));
                  const width = Math.max(1, dayDiff(parseDateString(start), parseDateString(end)) + 1);
                  return (
                    <div key={task.id} className={styles.ganttRow}>
                      <div className={styles.ganttLabelCol}>
                        <span className={styles.kanbanCardCode}>
                          {task.codePart} {task.name ? <span className="muted">({task.name})</span> : null}
                        </span>
                        <Badge tone="blue">{task.requiredSkill}</Badge>
                      </div>
                      <div className={styles.ganttTimeline}>
                        <div
                          className={styles.ganttBar}
                          style={{ left: `${(left / totalDays) * 100}%`, width: `${(width / totalDays) * 100}%` }}
                          title={`${formatDDMMYYYY(start)} → ${formatDDMMYYYY(end)}`}
                        />
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

