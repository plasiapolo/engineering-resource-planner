import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ApiPlanEntry, DateString } from "../../domain/types";
import { DEFAULT_WORKING_HOURS } from "../../domain/constants";
import { Badge } from "../ui/Badge";
import { addDays, isWorkingDay, parseDateString, startOfWeek, toDateString, weekDates, warsawToday } from "../../utils/date";
import { useAppState } from "../../store/AppStateContext";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Input, Field } from "../ui/Input";
import { Alert } from "../ui/Alert";
import styles from "./planner.module.css";

interface MoveTarget {
  userId: string;
  date: DateString;
  userName: string;
  skill: string | null;
}

function rowCodePart(codePart: string, specialistCode: string): string {
  const parts = codePart.split("-");
  if (parts.length < 3) return codePart;
  parts[1] = specialistCode;
  return parts.join("-");
}

function specialistCodeOf(name: string): string {
  return name.replace(/^Specialist\s*/, "").toUpperCase();
}

export function WeeklyCalendar({ isPM }: { isPM: boolean }) {
  const { data, selectedWeekStart, setSelectedWeekStart, updatePlanEntry, assignTask, deletePlanEntry, setPlanEntryLock } =
    useAppState();
  const [active, setActive] = useState<ApiPlanEntry | null>(null);
  const [pendingEntry, setPendingEntry] = useState<ApiPlanEntry | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [hoursInput, setHoursInput] = useState("8");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;

  const specialists = data.team.filter((m) => m.role === "SPECIALIST");
  const entries = data.planEntries;
  const availability = data.availability;
  const tasksById = new Map(data.tasks.map((t) => [t.id, t]));

  const weekStart = startOfWeek(parseDateString(selectedWeekStart));
  const days = weekDates(weekStart);
  const today = warsawToday();

  const hoursFor = (userId: string, date: DateString): number => {
    const record = availability.find((a) => a.userId === userId && a.date === date);
    return record ? record.availableHours : DEFAULT_WORKING_HOURS;
  };

  const plannedFor = (userId: string, date: DateString): number =>
    entries.filter((e) => e.userId === userId && e.date === date).reduce((s, e) => s + e.hours, 0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragStart = (event: DragStartEvent) => {
    const entry = entries.find((e) => e.id === String(event.active.id));
    setActive(entry ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragActive, over } = event;
    setActive(null);
    if (!over) return;
    const targetKey = String(over.id);
    if (!targetKey.startsWith("cell-")) return;
    const entry = entries.find((e) => e.id === String(dragActive.id));
    if (!entry) return;
    const parts = targetKey.slice(5).split("|");
    const targetUser = specialists.find((s) => s.id === parts[0]);
    if (!targetUser) return;
    if (targetUser.skill !== entry.requiredSkill) return;
    if (!isWorkingDay(parseDateString(parts[1]))) return;
    setPendingEntry(entry);
    setHoursInput(String(entry.hours));
    setMoveTarget({ userId: targetUser.id, date: parts[1], userName: targetUser.displayName, skill: targetUser.skill });
    setError(null);
  };

  const confirmMove = async () => {
    if (!moveTarget || !pendingEntry) return;
    setBusy(true);
    setError(null);
    try {
      const hours = Number(hoursInput);
      if (hours <= 0) throw new Error("Hours must be at least 1.");
      if (hours >= pendingEntry.hours) {
        await updatePlanEntry(pendingEntry.id, { userId: moveTarget.userId, date: moveTarget.date });
      } else {
        await updatePlanEntry(pendingEntry.id, { hours: pendingEntry.hours - hours });
        await assignTask(pendingEntry.taskId, [{ userId: moveTarget.userId, date: moveTarget.date, hours }]);
      }
      setMoveTarget(null);
      setPendingEntry(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed");
    } finally {
      setBusy(false);
    }
  };

  const cancelMove = () => {
    setMoveTarget(null);
    setPendingEntry(null);
    setError(null);
  };

  const prevWeek = () => setSelectedWeekStart(toDateString(addDays(weekStart, -7)));
  const nextWeek = () => setSelectedWeekStart(toDateString(addDays(weekStart, 7)));
  const thisWeek = () => setSelectedWeekStart(today);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActive(null)}>
      <div>
        <div className={styles.weekNav}>
          <Button variant="secondary" size="sm" onClick={prevWeek}>
            ‹
          </Button>
          <strong>
            {weekStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} —{" "}
            {addDays(weekStart, 6).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </strong>
          <Button variant="secondary" size="sm" onClick={nextWeek}>
            ›
          </Button>
          <Button variant="ghost" size="sm" onClick={thisWeek}>
            This week
          </Button>
          <span className="muted" style={{ fontSize: 12 }}>
            {isPM
              ? "Drag tasks between specialists with the same competence. Locked entries (orange edge) are manual; auto entries (blue edge) are generated."
              : "Read-only weekly view of your assigned tasks."}
          </span>
        </div>

        <div className={styles.calendarScroll}>
          <div className={styles.calendar}>
            <div className={styles.calendarHeader}>
              <div className={styles.cornerCell} />
              {days.map((day) => {
                const working = isWorkingDay(day);
                const isToday = toDateString(day) === today;
                return (
                  <div key={toDateString(day)} className={`${styles.dayHeader} ${isToday ? styles.dayHeaderToday : ""}`}>
                    <div>{day.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</div>
                    {!working ? <div className={styles.nonWorking}>non-working</div> : null}
                  </div>
                );
              })}
            </div>

            {specialists.map((specialist) => (
              <SpecialistRow
                key={specialist.id}
                member={specialist}
                specialistCode={specialist.login.toUpperCase()}
                days={days}
                today={today}
                entries={entries.filter((e) => e.userId === specialist.id)}
                tasksById={tasksById}
                hoursFor={hoursFor}
                plannedFor={plannedFor}
                isPM={isPM}
                onDelete={(entry) => void deletePlanEntry(entry.id)}
                onToggleLock={(entry) => void setPlanEntryLock(entry.id, !entry.locked)}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {active ? (
            <div className={`${styles.chip} ${active.locked ? styles.chipLocked : styles.chipAuto}`}>
              <span className={styles.chipCode}>{rowCodePart(active.taskCodePart, specialistCodeOf(active.userName))}</span>{" "}
              {active.hours}h
            </div>
          ) : null}
        </DragOverlay>

        <Modal open={moveTarget !== null} onClose={cancelMove} title="Move planned hours">
          {moveTarget && pendingEntry ? (
            <div>
              <p>
                Moving task{" "}
                <strong className="mono">{rowCodePart(pendingEntry.taskCodePart, specialistCodeOf(pendingEntry.userName))}</strong> (
                {pendingEntry.hours}h on {pendingEntry.date}) to <strong>{moveTarget.userName}</strong> on{" "}
                <strong>{moveTarget.date}</strong>.
              </p>
              <Field label="Hours to move" hint={`Between 1 and ${pendingEntry.hours}.`}>
                <Input type="number" min={1} max={pendingEntry.hours} value={hoursInput} onChange={(e) => setHoursInput(e.target.value)} />
              </Field>
              {error ? (
                <div className="mt-8">
                  <Alert tone="danger">{error}</Alert>
                </div>
              ) : null}
              <div className="mt-16 flex">
                <Button onClick={() => void confirmMove()} disabled={busy}>
                  {busy ? "Moving…" : "Move hours"}
                </Button>
                <Button variant="ghost" onClick={cancelMove}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </Modal>
      </div>
    </DndContext>
  );
}

function SpecialistRow({
  member,
  specialistCode,
  days,
  today,
  entries,
  tasksById,
  hoursFor,
  plannedFor,
  isPM,
  onDelete,
  onToggleLock,
}: {
  member: { id: string; displayName: string; skill: string | null };
  specialistCode: string;
  days: Date[];
  today: string;
  entries: ApiPlanEntry[];
  tasksById: Map<string, { codePart: string }>;
  hoursFor: (userId: string, date: string) => number;
  plannedFor: (userId: string, date: string) => number;
  isPM: boolean;
  onDelete: (entry: ApiPlanEntry) => void;
  onToggleLock: (entry: ApiPlanEntry) => void;
}) {
  const entriesByDate = new Map<string, ApiPlanEntry[]>();
  for (const entry of entries) {
    const list = entriesByDate.get(entry.date) ?? [];
    list.push(entry);
    entriesByDate.set(entry.date, list);
  }

  return (
    <>
      <div className={styles.userCell}>
        <strong>{member.displayName}</strong>
        <span className={styles.userSkill}>skill {member.skill ?? "—"}</span>
      </div>
      {days.map((day) => {
        const date = toDateString(day);
        const working = isWorkingDay(day);
        const hours = hoursFor(member.id, date);
        const planned = plannedFor(member.id, date);
        const unavailable = hours === 0;
        const dayEntries = entriesByDate.get(date) ?? [];
        const mergedEntries: Array<{ entry: ApiPlanEntry; hours: number }> = [];
        for (const entry of dayEntries) {
          const existing = mergedEntries.find((m) => m.entry.taskId === entry.taskId);
          if (existing) {
            existing.hours += entry.hours;
          } else {
            mergedEntries.push({ entry, hours: entry.hours });
          }
        }
        const isToday = date === today;
        return (
          <DroppableCell
            key={date}
            userId={member.id}
            date={date}
            working={working}
            unavailable={unavailable}
            isToday={isToday}
            availableLabel={unavailable ? "not available" : `${hours}h`}
            overloaded={planned > hours}
          >
            {mergedEntries.map(({ entry, hours }) => (
              <DraggableChip
                key={entry.id}
                entry={{ ...entry, hours }}
                codePart={rowCodePart(tasksById.get(entry.taskId)?.codePart ?? entry.taskCodePart, specialistCode)}
                draggable={isPM && working && !unavailable}
                onDelete={() => onDelete(entry)}
                onToggleLock={() => onToggleLock(entry)}
              />
            ))}
          </DroppableCell>
        );
      })}
    </>
  );
}

function DroppableCell({
  userId,
  date,
  working,
  unavailable,
  isToday,
  availableLabel,
  overloaded,
  children,
}: {
  userId: string;
  date: string;
  working: boolean;
  unavailable: boolean;
  isToday: boolean;
  availableLabel: string;
  overloaded: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${userId}|${date}`, disabled: !working });
  return (
    <div
      ref={setNodeRef}
      className={`${styles.cell} ${working ? styles.cellWorking : styles.cellNonWorking} ${unavailable ? styles.cellUnavailable : ""} ${
        isToday ? styles.cellToday : ""
      } ${isOver ? styles.cellOver : ""}`}
    >
      {working ? (
        <div className={styles.cellLabel}>
          <span className={unavailable ? styles.availNone : overloaded ? styles.availOver : styles.availOk}>
            {availableLabel}
          </span>
          {unavailable ? <Badge tone="gray">not available</Badge> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function DraggableChip({
  entry,
  codePart,
  draggable,
  onDelete,
  onToggleLock,
}: {
  entry: ApiPlanEntry;
  codePart: string;
  draggable: boolean;
  onDelete: () => void;
  onToggleLock: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: entry.id, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`${styles.chip} ${entry.locked ? styles.chipLocked : styles.chipAuto} ${isDragging ? styles.chipDragging : ""} ${
        draggable ? "" : styles.chipReadonly
      }`}
      title={entry.locked ? "Manual (locked) — automatic planning cannot modify it" : "Auto-generated"}
    >
      <span className={styles.chipCode}>{codePart}</span>
      <span className={styles.chipHours}>{entry.hours}h</span>
      {draggable ? (
        <span className={styles.chipActions}>
          <button
            className={styles.chipAction}
            title={entry.locked ? "Unlock (allow auto planning)" : "Lock (protect from auto planning)"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock();
            }}
          >
            {entry.locked ? "Unlock" : "Lock"}
          </button>
          <button
            className={styles.chipAction}
            title="Remove entry"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            ×
          </button>
        </span>
      ) : null}
    </div>
  );
}