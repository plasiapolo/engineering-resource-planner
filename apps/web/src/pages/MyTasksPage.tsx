import { useState } from "react";
import { useAppState } from "../store/AppStateContext";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { Input, Field } from "../components/ui/Input";
import { EmptyState } from "../components/ui/Extras";
import { ALLOWED_TRANSITIONS, TASK_STATUS_LABELS } from "../domain/constants";
import type { TaskStatus } from "../domain/types";
import styles from "./pages.module.css";

export function MyTasksPage() {
  const { user, data, updateTaskStatus } = useAppState();
  const [transitioning, setTransitioning] = useState<{ taskId: string; code: string; to: TaskStatus; workedHours: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user || !data) return null;

  const myTasks = data.tasks.filter((t) => t.assignedUserIds.includes(user.id));

  const statusTone = (status: string) =>
    status === "DONE" ? "green" : status === "ON_HOLD" ? "orange" : status === "WORK_IN_PROGRESS" ? "blue" : "neutral";

  const confirmTransition = async () => {
    if (!transitioning) return;
    setBusy(true);
    try {
      const worked = Number(transitioning.workedHours);
      await updateTaskStatus(
        transitioning.taskId,
        transitioning.to,
        Number.isFinite(worked) && worked >= 0 ? worked : undefined,
      );
      setTransitioning(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="page-subtitle">
        Update the status of your tasks. Reporting hours worked reduces the remaining hours that stay planable.
      </p>

      <Card pad={false}>
        <Table
          rows={myTasks}
          rowKey={(t) => t.id}
          empty={<EmptyState title="No tasks assigned to you" hint="The project manager assigns tasks to specialists." />}
          columns={[
            { key: "code", header: "Task code", render: (t) => <span className={styles.taskCode}>{t.codePart}</span> },
            { key: "project", header: "Project", render: (t) => `${t.projectCode} — ${t.projectName}` },
            { key: "skill", header: "Skill", render: (t) => <Badge tone="blue">{t.requiredSkill}</Badge> },
            { key: "hoursEstimated", header: "Hours estimated", render: (t) => `${t.estimatedHours}h` },
            { key: "hoursPlanned", header: "Hours planned", render: (t) => `${t.scheduledHours}h` },
            { key: "hoursAvailable", header: "Hours available", render: (t) => `${Math.max(0, t.estimatedHours - t.scheduledHours)}h` },
            {
              key: "worked",
              header: "Worked",
              render: (t) => `${t.actualWorkedHours}h`,
            },
            { key: "status", header: "Status", render: (t) => <Badge tone={statusTone(t.status)}>{TASK_STATUS_LABELS[t.status]}</Badge> },
            {
              key: "actions",
              header: "Transition",
              render: (t) => (
                <div className="flex wrap">
                  {ALLOWED_TRANSITIONS[t.status].map((next) => (
                    <Button
                      key={next}
                      size="sm"
                      variant={next === "DONE" ? "danger" : next === "WORK_IN_PROGRESS" ? "primary" : "secondary"}
                      onClick={() => setTransitioning({ taskId: t.id, code: t.codePart, to: next, workedHours: String(t.actualWorkedHours) })}
                    >
                      {TASK_STATUS_LABELS[next]}
                    </Button>
                  ))}
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Modal open={transitioning !== null} onClose={() => setTransitioning(null)} title="Update task status">
        {transitioning ? (
          <div>
            <p>
              Task <strong className="mono">{transitioning.code}</strong> → <strong>{TASK_STATUS_LABELS[transitioning.to]}</strong>
            </p>
            <Field label="Hours worked so far" hint="This reduces the planable remaining hours.">
              <Input
                type="number"
                min={0}
                value={transitioning.workedHours}
                onChange={(e) => setTransitioning({ ...transitioning, workedHours: e.target.value })}
              />
            </Field>
            <div className="mt-16 flex">
              <Button onClick={() => void confirmTransition()} disabled={busy}>
                {busy ? "Saving…" : "Save status"}
              </Button>
              <Button variant="ghost" onClick={() => setTransitioning(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}