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
import { useAppState } from "../store/AppStateContext";
import { Card, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/Extras";
import { Alert } from "../components/ui/Alert";
import type { ApiTask, TaskStatus } from "../domain/types";
import styles from "./pages.module.css";

type ColumnKey = "to_do" | "on_hold" | "wip" | "done";

const COLUMN_ORDER: Array<{ key: ColumnKey; title: string; status: TaskStatus }> = [
  { key: "to_do", title: "To do", status: "NOT_STARTED" },
  { key: "on_hold", title: "On hold", status: "ON_HOLD" },
  { key: "wip", title: "Work in progress", status: "WORK_IN_PROGRESS" },
  { key: "done", title: "Done", status: "DONE" },
];

function statusToColumn(status: TaskStatus): ColumnKey {
  switch (status) {
    case "ON_HOLD":
      return "on_hold";
    case "WORK_IN_PROGRESS":
      return "wip";
    case "DONE":
      return "done";
    default:
      return "to_do";
  }
}

function KanbanCard({ task, draggable }: { task: ApiTask; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`${styles.kanbanCard} ${isDragging ? styles.kanbanCardDragging : ""} ${draggable ? "" : styles.kanbanCardReadonly}`}
    >
      <div className={styles.kanbanCardCode}>
        {task.codePart} {task.name ? <span className="muted">({task.name})</span> : null}
      </div>
      <div className={styles.kanbanCardMeta}>
        <Badge tone="blue">{task.requiredSkill}</Badge>
        <span className="muted">{task.remainingHours}h</span>
      </div>
    </div>
  );
}

function KanbanColumn({
  column,
  tasks,
  draggableFor,
  onOpen,
}: {
  column: (typeof COLUMN_ORDER)[number];
  tasks: ApiTask[];
  draggableFor: (task: ApiTask) => boolean;
  onOpen: (task: ApiTask) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  return (
    <div ref={setNodeRef} className={`${styles.kanbanColumn} ${isOver ? styles.kanbanColumnOver : ""}`}>
      <div className={styles.kanbanColumnHeader}>
        <strong>{column.title}</strong>
        <span className="muted">{tasks.length}</span>
      </div>
      <div className={styles.kanbanColumnBody}>
        {tasks.length === 0 ? <p className={styles.kanbanEmpty}>Drop tasks here</p> : null}
        {tasks.map((task) => (
          <div key={task.id} onClick={() => onOpen(task)}>
            <KanbanCard task={task} draggable={draggableFor(task)} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function KanbanPage() {
  const { data, user, updateTaskStatus } = useAppState();
  const [active, setActive] = useState<ApiTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (!data) return null;
  const isPM = user?.role === "PROJECT_MANAGER";
  const today = new Date().toISOString().slice(0, 10);

  const draggableFor = (task: ApiTask) => {
    if (isPM) return true;
    return task.assignedUserIds.includes(user!.id);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActive(data.tasks.find((t) => t.id === String(event.active.id)) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActive(null);
    const over = event.over;
    if (!over) return;
    const taskId = String(event.active.id);
    const targetColumn = COLUMN_ORDER.find((c) => c.key === String(over.id));
    if (!targetColumn) return;
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (task.status === targetColumn.status) return;
    setError(null);
    void updateTaskStatus(taskId, targetColumn.status).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Failed to move task"),
    );
  };

  return (
    <div>
      <p className="page-subtitle">
        Kanban boards per project showing the current status. Drag tasks between columns to update their status.
      </p>
      {error ? (
        <div className="mb-16">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActive(null)}>
        {data.projects.length === 0 ? (
          <Card>
            <EmptyState title="No projects" hint="Create a project first, then add tasks to see the Kanban board." />
          </Card>
        ) : (
          data.projects.map((project) => {
            const projectTasks = data.tasks.filter((t) => t.projectId === project.id);
            return (
              <Card key={project.id} className="mb-16">
                <CardHeader title={`${project.code} — ${project.name}`} subtitle={`${projectTasks.length} tasks`} />
                <div className={styles.kanbanBoard}>
                  {COLUMN_ORDER.map((column) => (
                    <KanbanColumn
                      key={column.key}
                      column={column}
                      tasks={projectTasks.filter((t) => statusToColumn(t.status) === column.key)}
                      draggableFor={draggableFor}
                      onOpen={() => undefined}
                    />
                  ))}
                </div>
              </Card>
            );
          })
        )}
        <DragOverlay>
          {active ? (
            <div className={styles.kanbanCard}>
              <div className={styles.kanbanCardCode}>
                {active.codePart} {active.name ? <span className="muted">({active.name})</span> : null}
              </div>
              <div className={styles.kanbanCardMeta}>
                <Badge tone="blue">{active.requiredSkill}</Badge>
                <span className="muted">{active.remainingHours}h</span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <p className="muted" style={{ fontSize: 12 }}>
        Boards reflect the status for the current day ({today}). Specialists can move only their own tasks; the project
        manager can move all tasks.
      </p>
    </div>
  );
}
