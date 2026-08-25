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
import { taskCodesForSkill } from "../utils/taskCodes";
import styles from "./pages.module.css";

type ColumnKey = "to_do" | "on_hold" | "wip" | "done";

const COLUMN_ORDER: Array<{ key: ColumnKey; title: string; status: TaskStatus }> = [
  { key: "to_do", title: "To do", status: "NOT_STARTED" },
  { key: "on_hold", title: "On hold", status: "ON_HOLD" },
  { key: "wip", title: "Work in progress", status: "WORK_IN_PROGRESS" },
  { key: "done", title: "Done", status: "DONE" },
];

function KanbanCard({ task, code, draggable }: { task: ApiTask; code: string; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${task.id}|${code}`,
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`${styles.kanbanCard} ${isDragging ? styles.kanbanCardDragging : ""} ${draggable ? "" : styles.kanbanCardReadonly}`}
    >
      <div className={styles.kanbanCardCode}>
        <span className={styles.kanbanCardCodeLine}>{code}</span>
        {task.name ? <span className="muted">({task.name})</span> : null}
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
  cards,
  draggableFor,
  onOpen,
}: {
  column: (typeof COLUMN_ORDER)[number];
  cards: Array<{ task: ApiTask; code: string }>;
  draggableFor: (code: string) => boolean;
  onOpen: (task: ApiTask) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  return (
    <div ref={setNodeRef} className={`${styles.kanbanColumn} ${isOver ? styles.kanbanColumnOver : ""}`}>
      <div className={styles.kanbanColumnHeader}>
        <strong>{column.title}</strong>
        <span className="muted">{cards.length}</span>
      </div>
      <div className={styles.kanbanColumnBody}>
        {cards.length === 0 ? <p className={styles.kanbanEmpty}>Drop tasks here</p> : null}
        {cards.map(({ task, code }) => (
          <div key={`${task.id}|${code}`} onClick={() => onOpen(task)}>
            <KanbanCard task={task} code={code} draggable={draggableFor(code)} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function KanbanPage() {
  const { data, user, updateTaskUserStatus } = useAppState();
  const [active, setActive] = useState<ApiTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (!data) return null;
  const isPM = user?.role === "PROJECT_MANAGER";
  const today = new Date().toISOString().slice(0, 10);
  const specialists = data.team
    .filter((m) => m.role === "SPECIALIST")
    .map((m) => ({ id: m.id, login: m.login, skill: m.skill }));

  const codeToUser = (code: string) => {
    const segments = code.split("-");
    if (segments.length < 3) return undefined;
    const codeSeg = segments[1];
    return specialists.find((s) => s.login.toUpperCase() === codeSeg);
  };

  const statusOf = (task: ApiTask, code: string): TaskStatus => {
    const userSpec = codeToUser(code);
    if (!userSpec) return task.status;
    return task.statusByUser[userSpec.id] ?? task.status;
  };

  const draggableFor = (code: string) => {
    if (isPM) return true;
    const myCode = user!.login.toUpperCase();
    const segments = code.split("-");
    return segments.length >= 3 && segments[1] === myCode;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const taskId = String(event.active.id).split("|")[0];
    setActive(data.tasks.find((t) => t.id === taskId) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActive(null);
    const over = event.over;
    if (!over) return;
    const [taskId, code] = String(event.active.id).split("|");
    const targetColumn = COLUMN_ORDER.find((c) => c.key === String(over.id));
    if (!targetColumn) return;
    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const userSpec = codeToUser(code);
    if (!userSpec) return;
    if (statusOf(task, code) === targetColumn.status) return;
    setError(null);
    void updateTaskUserStatus(taskId, userSpec.id, targetColumn.status).catch((err: unknown) =>
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
            const projectCards = projectTasks.flatMap((task) =>
              taskCodesForSkill(task, specialists).map((code) => ({ task, code, status: statusOf(task, code) })),
            );
            return (
              <Card key={project.id} className="mb-16">
                <CardHeader title={`${project.code} — ${project.name}`} subtitle={`${projectCards.length} specialist boxes`} />
                <div className={styles.kanbanBoard}>
                  {COLUMN_ORDER.map((column) => (
                    <KanbanColumn
                      key={column.key}
                      column={column}
                      cards={projectCards.filter((c) => c.status === column.status)}
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
                {taskCodesForSkill(active, specialists).map((code) => (
                  <span key={code} className={styles.kanbanCardCodeLine}>
                    {code}
                  </span>
                ))}
                {active.name ? <span className="muted">({active.name})</span> : null}
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
        Boards reflect the status for the current day ({today}). Each specialist manages their own task status; the
        project manager can move all.
      </p>
    </div>
  );
}
