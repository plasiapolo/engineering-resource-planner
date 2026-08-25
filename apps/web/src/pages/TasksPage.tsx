import { useState } from "react";
import { useAppState } from "../store/AppStateContext";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Select } from "../components/ui/Input";
import { EmptyState, ConfirmDialog } from "../components/ui/Extras";
import { TaskFormModal } from "../components/tasks/TaskFormModal";
import { AssignmentEditor } from "../components/tasks/AssignmentEditor";
import { TASK_STATUS_LABELS } from "../domain/constants";
import { taskCodesOf } from "../utils/taskCodes";
import styles from "./pages.module.css";

export function TasksPage() {
  const { data, deleteTask, removeAssignment } = useAppState();
  const [projectFilter, setProjectFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<null | { id: string; name: string; estimatedHours: number; taskDeadline: string | null; requiredSkill: "A" | "B" | "C" | "E" | "P" | "S"; projectId: string }>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; code: string } | null>(null);
  const [removing, setRemoving] = useState<Record<string, boolean>>({});

  if (!data) return null;

  const tasks = projectFilter === "all" ? data.tasks : data.tasks.filter((t) => t.projectId === projectFilter);

  const statusTone = (status: string) =>
    status === "DONE" ? "green" : status === "ON_HOLD" ? "orange" : status === "WORK_IN_PROGRESS" ? "blue" : "neutral";

  const handleRemoveAssignment = async (taskId: string, userId: string) => {
    const key = `${taskId}:${userId}`;
    setRemoving((prev) => ({ ...prev, [key]: true }));
    try {
      await removeAssignment(taskId, userId);
    } catch {
      // state refresh failure is surfaced by the app; keep going
    } finally {
      setRemoving((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div>
      <div className={styles.toolbar}>
        <div className="flex">
          <Select
            style={{ width: 240 }}
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="all">All projects</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className={styles.toolbarActions}>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + New task
          </Button>
        </div>
      </div>

      <Card pad={false}>
        <Table
          rows={tasks}
          rowKey={(t) => t.id}
          empty={<EmptyState title="No tasks" hint="Add tasks and assign specialists with matching skills." />}
          columns={[
            { key: "code", header: "Task code", render: (t) => {
              const codes = taskCodesOf(t);
              return (
                <span className={styles.taskCode}>
                  {codes.map((c, i) => (
                    <span key={i}>
                      {c}
                      {i < codes.length - 1 ? <br /> : null}
                    </span>
                  ))}
                </span>
              );
            } },
            { key: "project", header: "Project", render: (t) => `${t.projectCode}` },
            { key: "projectName", header: "Project name", render: (t) => <strong>{t.projectName}</strong> },
            { key: "taskName", header: "Task name", render: (t) => (t.name ? <span>{t.name}</span> : <span className="muted">—</span>) },
            {
              key: "skill",
              header: "Skill",
              render: (t) => <Badge tone="blue">{t.requiredSkill}</Badge>,
            },
            { key: "hoursEstimated", header: "Hours estimated", render: (t) => `${t.estimatedHours}h` },
            {
              key: "hoursPlanned",
              header: "Hours planned",
              render: (t) => `${t.scheduledHours}h`,
            },
            {
              key: "hoursAvailable",
              header: "Hours available",
              render: (t) => `${Math.max(0, t.estimatedHours - t.scheduledHours)}h`,
            },
            {
              key: "assigned",
              header: "Assigned",
              render: (t) =>
                t.assignedUsers.length > 0 ? (
                  <div className="flex wrap">
                    {t.assignedUsers.map((u) => (
                      <span key={u.id} className="flex" style={{ alignItems: "center", gap: 2 }}>
                        <Badge tone="neutral">{u.login}</Badge>
                        <button
                          type="button"
                          className="text-danger"
                          disabled={removing[`${t.id}:${u.id}`]}
                          onClick={() => void handleRemoveAssignment(t.id, u.id)}
                          title={`Remove ${u.login}`}
                          aria-label={`Remove ${u.login}`}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 14,
                            lineHeight: 1,
                            padding: "2px 4px",
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              key: "status",
              header: "Status",
              render: (t) => <Badge tone={statusTone(t.status)}>{TASK_STATUS_LABELS[t.status]}</Badge>,
            },
            {
              key: "actions",
              header: "",
              render: (t) => (
                <div className="flex">
                  <Button size="sm" variant={assigning === t.id ? "accent" : "secondary"} onClick={() => setAssigning(assigning === t.id ? null : t.id)}>
                    Assign
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing({
                        id: t.id,
                        name: t.name,
                        estimatedHours: t.estimatedHours,
                        taskDeadline: t.taskDeadline,
                        requiredSkill: t.requiredSkill,
                        projectId: t.projectId,
                      });
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting({ id: t.id, code: t.codePart })}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {assigning ? (
        <div className="mt-16">
          <Card>
            {data.tasks.find((t) => t.id === assigning) ? (
              <AssignmentEditor
                task={data.tasks.find((t) => t.id === assigning)!}
                onClose={() => setAssigning(null)}
              />
            ) : null}
          </Card>
        </div>
      ) : null}

      <TaskFormModal
        key={editing?.id ?? "new"}
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        projectId={projectFilter !== "all" ? projectFilter : data.projects[0]?.id ?? ""}
        task={editing}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete task"
        message={`Delete task "${deleting?.code}"? Its plan entries and conflicts will be soft-deleted.`}
        confirmLabel="Delete task"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteTask(deleting.id);
          setDeleting(null);
        }}
      />

      <div className="mt-16">
        <p className="muted" style={{ fontSize: 12 }}>
          Tip: tick a specialist to assign them, then choose working days and hours. Assigned tasks appear in the
          Planner calendar and can be drag-dropped between specialists of the same competence.
        </p>
      </div>
    </div>
  );
}