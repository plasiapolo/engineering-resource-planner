import { useMemo, useState } from "react";
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
import type { ApiTask } from "../../domain/types";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Alert } from "../ui/Alert";
import styles from "./pyramid.module.css";

interface DraggableTaskProps {
  task: ApiTask;
  codePart: string;
}

function DraggableTask({ task, codePart }: DraggableTaskProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`${styles.task} ${isDragging ? styles.taskDragging : ""}`}
    >
      <span className={styles.taskCode}>{codePart}</span>
      {task.name ? <span className={styles.taskName}> ({task.name})</span> : null}
      <Badge tone="blue">{task.requiredSkill}</Badge>
      <span className={styles.taskHours}>{task.remainingHours}h</span>
    </div>
  );
}

function displayCodePart(task: ApiTask, rowIndex: number): string {
  const segments = task.codePart.split("-");
  if (segments.length >= 3) {
    return `${segments[0]}-${task.requiredSkill}X-${rowIndex + 1}`;
  }
  return task.codePart;
}

function RowDropZone({
  row,
  index,
  tasks,
}: {
  row: string[];
  index: number;
  tasks: ApiTask[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `row-${index}` });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return (
    <div className={styles.rowWrap}>
      <span className={styles.rowLabel}>Row {index + 1}</span>
      <div ref={setNodeRef} className={`${styles.row} ${isOver ? styles.rowOver : ""}`}>
        {row.length === 0 ? <span className={styles.rowEmpty}>Drop tasks here</span> : null}
        {row.map((id) => {
          const task = byId.get(id);
          if (!task) return null;
          return <DraggableTask key={id} task={task} codePart={displayCodePart(task, index)} />;
        })}
      </div>
    </div>
  );
}

export function PyramidEditor({
  tasks,
  onSave,
  saving,
}: {
  tasks: ApiTask[];
  onSave: (rows: string[][]) => Promise<void>;
  saving?: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const initialRows = useMemo(() => {
    const byRow = new Map<number, string[]>();
    for (const task of tasks) {
      const list = byRow.get(task.rowIndex) ?? [];
      list.push(task.id);
      byRow.set(task.rowIndex, list);
    }
    const maxRow = tasks.reduce((m, t) => Math.max(m, t.rowIndex), 0);
    const rows: string[][] = [];
    for (let r = 0; r <= maxRow; r += 1) {
      rows.push(byRow.get(r) ?? []);
    }
    return rows;
  }, [tasks]);

  const [rows, setRows] = useState<string[][]>(initialRows);
  const [active, setActive] = useState<ApiTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === String(event.active.id));
    setActive(task ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActive(null);
    const { active: dragActive, over } = event;
    if (!over) return;
    const target = String(over.id);
    if (!target.startsWith("row-")) return;
    const targetRow = Number(target.slice(4));
    setRows((prev) => {
      const next = prev.map((row) => row.filter((id) => id !== String(dragActive.id)));
      while (next.length <= targetRow) next.push([]);
      next[targetRow].push(String(dragActive.id));
      return next;
    });
  };

  const save = async () => {
    setError(null);
    const flattened = rows.flat();
    const taskIds = new Set(tasks.map((t) => t.id));
    if (flattened.length !== taskIds.size || flattened.some((id) => !taskIds.has(id))) {
      setError("All tasks of the project must be placed in exactly one row before saving.");
      return;
    }
    try {
      await onSave(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <div>
      <div className="flex-between mb-16">
        <p className="page-subtitle" style={{ margin: 0 }}>
          Drag tasks between rows. Every task in a lower row must finish before tasks in the row above start. The row
          order defines all dependencies and updates the task code automatically.
        </p>
        <div className="flex">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRows((prev) => [...prev, []])}
          >
            + Add row
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={rows.length <= 1 || rows[rows.length - 1].length > 0}
            title={rows[rows.length - 1].length > 0 ? "Move tasks out of the last row first" : "Remove the last row"}
            onClick={() => setRows((prev) => prev.slice(0, -1))}
          >
            Delete row
          </Button>
          <Button variant="accent" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save pyramid"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-16">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActive(null)}
      >
        <div className={styles.pyramid}>
          {rows.map((row, index) => (
            <RowDropZone key={index} row={row} index={index} tasks={tasks} />
          ))}
        </div>
        <DragOverlay>{active ? <DraggableTask task={active} codePart={active.codePart} /> : null}</DragOverlay>
      </DndContext>

      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        Row 1 is the lowest row. Tasks in the same row run in parallel. Dependencies can only be changed here — this
        pyramid is the single source of truth for task dependencies.
      </p>
    </div>
  );
}
