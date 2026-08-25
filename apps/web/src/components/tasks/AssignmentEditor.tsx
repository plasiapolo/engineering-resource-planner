import { useState } from "react";
import type { ApiTask, ApiPlanEntry, DateString } from "../../domain/types";
import { addDays, isWorkingDay, parseDateString, toDateString, warsawToday } from "../../utils/date";
import { useAppState } from "../../store/AppStateContext";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import { Alert } from "../ui/Alert";
import styles from "./tasks.module.css";

export function AssignmentEditor({ task, onClose }: { task: ApiTask; onClose: () => void }) {
  const { data, assignTask, updatePlanEntry, deletePlanEntry } = useAppState();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [ranges, setRanges] = useState<Record<string, { start: string; end: string; hours: string }>>({});
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editHours, setEditHours] = useState("8");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const specialists = (data?.team ?? []).filter((m) => m.role === "SPECIALIST" && m.skill === task.requiredSkill);
  const existingEntries = (data?.planEntries ?? []).filter((e) => e.taskId === task.id);
  const today = warsawToday();

  const toggle = (userId: string, value: boolean) => {
    setChecked((prev) => ({ ...prev, [userId]: value }));
    if (value && !ranges[userId]) {
      setRanges((prev) => ({ ...prev, [userId]: { start: today, end: today, hours: "8" } }));
    }
  };

  const updateRange = (userId: string, field: "start" | "end" | "hours", value: string) => {
    setRanges((prev) => ({ ...prev, [userId]: { ...prev[userId], [field]: value } }));
  };

  const submit = async () => {
    const assignments: Array<{ userId: string; date: DateString; hours: number }> = [];
    for (const userId of Object.keys(ranges)) {
      if (!checked[userId]) continue;
      const range = ranges[userId];
      if (!range || !range.start || !range.end) {
        setError("Enter both a start day and a last day for each selected specialist.");
        return;
      }
      const hours = Number(range.hours);
      if (!Number.isInteger(hours) || hours < 1 || hours > 8) {
        setError("Hours per day must be between 1 and 8.");
        return;
      }
      const start = parseDateString(range.start);
      const end = parseDateString(range.end);
      if (!start || !end || end < start) {
        setError("Last day must be on or after the start day.");
        return;
      }
      for (let d = start; d <= end; d = addDays(d, 1)) {
        if (isWorkingDay(d)) {
          assignments.push({ userId, date: toDateString(d), hours });
        }
      }
    }
    if (assignments.length === 0) {
      setError("Tick at least one specialist and enter a start and last day.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await assignTask(task.id, assignments);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (entry: ApiPlanEntry) => {
    setEditingEntry(entry.id);
    setEditDate(entry.date);
    setEditHours(String(entry.hours));
    setError(null);
  };

  const saveEdit = async () => {
    if (!editingEntry) return;
    const hours = Number(editHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 8) {
      setError("Hours must be between 1 and 8.");
      return;
    }
    const parsed = parseDateString(editDate);
    if (!parsed) {
      setError("Enter a valid date.");
      return;
    }
    if (!isWorkingDay(parsed)) {
      setError(`${editDate} is not a working day.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updatePlanEntry(editingEntry, { date: editDate, hours });
      setEditingEntry(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.editor}>
      <div className="flex-between mb-16">
        <div>
          <strong className={styles.editorTitle}>
            {task.codePart} <Badge tone="blue">{task.requiredSkill}</Badge>
          </strong>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Available hours: {Math.max(0, task.estimatedHours - task.scheduledHours)}h · Assign a start day and a last day; every working day in between is assigned.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      {specialists.length === 0 ? (
        <Alert tone="warning">No specialist has the required skill ({task.requiredSkill}).</Alert>
      ) : (
        <div className={styles.editorGrid}>
          {specialists.map((specialist) => (
            <div key={specialist.id} className={styles.specialistBlock}>
              <label className={styles.tickRow}>
                <input type="checkbox" checked={!!checked[specialist.id]} onChange={(e) => toggle(specialist.id, e.target.checked)} />
                <span>
                  <strong>{specialist.displayName}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {" "}
                    · {specialist.login}
                  </span>
                </span>
              </label>
              {checked[specialist.id] ? (
                <div className={styles.dayRows}>
                  <div className={styles.dayRow}>
                    <label className="muted" style={{ fontSize: 12 }}>
                      Start day
                    </label>
                    <Input
                      type="date"
                      value={ranges[specialist.id]?.start ?? today}
                      onChange={(e) => updateRange(specialist.id, "start", e.target.value)}
                    />
                  </div>
                  <div className={styles.dayRow}>
                    <label className="muted" style={{ fontSize: 12 }}>
                      Last day
                    </label>
                    <Input
                      type="date"
                      value={ranges[specialist.id]?.end ?? today}
                      onChange={(e) => updateRange(specialist.id, "end", e.target.value)}
                    />
                  </div>
                  <div className={styles.dayRow}>
                    <label className="muted" style={{ fontSize: 12 }}>
                      Hours/day
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={8}
                      value={ranges[specialist.id]?.hours ?? "8"}
                      onChange={(e) => updateRange(specialist.id, "hours", e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {existingEntries.length > 0 ? (
        <div className="mt-16">
          <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Currently planned
          </p>
          <div className={styles.existing}>
            {existingEntries.map((entry) => (
              <div key={entry.id} className={styles.existingRow}>
                {editingEntry === entry.id ? (
                  <div className={styles.dayRow}>
                    <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                    <Input type="number" min={1} max={8} value={editHours} onChange={(e) => setEditHours(e.target.value)} />
                    <Button size="sm" variant="accent" onClick={() => void saveEdit()} disabled={busy}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingEntry(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <span>
                      {entry.date} · {entry.userName} · <strong>{entry.hours}h</strong>
                      {entry.locked ? <Badge tone="blue">locked</Badge> : <Badge tone="orange">auto</Badge>}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => beginEdit(entry)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => void deletePlanEntry(entry.id)}>
                      Remove
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-16">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-16 flex">
        <Button variant="accent" onClick={() => void submit()} disabled={busy}>
          {busy ? "Applying…" : "Apply assignment"}
        </Button>
      </div>
    </div>
  );
}
