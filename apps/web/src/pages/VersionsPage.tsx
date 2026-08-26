import { useState } from "react";
import { useAppState } from "../store/AppStateContext";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog, EmptyState, Spinner } from "../components/ui/Extras";
import { Alert } from "../components/ui/Alert";
import { api } from "../services/api";
import type { ApiVersionDetail } from "../domain/types";
import { CONFLICT_SEVERITY_LABELS, CONFLICT_TYPE_LABELS } from "../domain/constants";
import { formatDateTime } from "../utils/date";
import styles from "./pages.module.css";

export function VersionsPage() {
  const { data, resetDatabase, wipeAll } = useAppState();
  const [selected, setSelected] = useState<ApiVersionDetail | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  if (!data) return null;

  const openVersion = async (id: string) => {
    setLoadingVersion(true);
    setVersionError(null);
    setSelected(null);
    try {
      const detail = await api.getVersion(id);
      setSelected(detail);
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : "Failed to load snapshot");
    } finally {
      setLoadingVersion(false);
    }
  };

  const severityTone = (s: string) => (s === "CRITICAL" || s === "ERROR" ? "red" : s === "WARNING" ? "orange" : "blue");

  const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

  const printSnapshot = (detail: ApiVersionDetail) => {
    const win = window.open("", "_blank", "width=960,height=720");
    if (!win) return;
    const entriesRows = detail.planEntries
      .map(
        (e) =>
          `<tr><td>${escapeHtml(e.date)}</td><td class="mono">${escapeHtml(e.taskCode.split(".")[0])}</td><td>${escapeHtml(
            e.userName,
          )}</td><td>${e.hours}h</td><td>${e.locked ? "manual" : "auto"}</td></tr>`,
      )
      .join("");
    const conflictCards = detail.conflicts
      .map(
        (c) =>
          `<div class="conflict"><span class="sev sev-${c.severity.toLowerCase()}">${escapeHtml(
            CONFLICT_SEVERITY_LABELS[c.severity],
          )}</span><strong>${escapeHtml(CONFLICT_TYPE_LABELS[c.type] ?? c.type)}</strong> — ${escapeHtml(
            c.title,
          )}<div class="desc">${escapeHtml(c.description)}</div></div>`,
      )
      .join("");
    win.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Plan snapshot ${escapeHtml(detail.snapshotDate)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; color: #1f2933; margin: 0; }
  @page { margin: 14mm; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 20px 0 8px; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; }
  .sub { color: #6b7280; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; }
  td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .conflict { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; page-break-inside: avoid; }
  .sev { display: inline-block; font-size: 10px; font-weight: 600; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; margin-right: 6px; vertical-align: 1px; }
  .sev-critical, .sev-error { background: #fee2e2; color: #991b1b; }
  .sev-warning { background: #ffedd5; color: #9a3412; }
  .sev-info { background: #dbeafe; color: #1e40af; }
  .desc { color: #6b7280; margin-top: 4px; }
  .foot { color: #9ca3af; font-size: 10px; margin-top: 24px; }
  tr { page-break-inside: avoid; }
</style>
</head>
<body>
  <h1>Plan snapshot ${escapeHtml(detail.snapshotDate)}</h1>
  <p class="sub">${detail.planEntries.length} entries &middot; ${detail.conflicts.length} conflicts</p>
  <h2>Plan entries</h2>
  <table>
    <thead><tr><th>Date</th><th>Task code</th><th>Specialist</th><th>Hours</th><th>Lock</th></tr></thead>
    <tbody>${entriesRows || '<tr><td colspan="5">No entries in this snapshot.</td></tr>'}</tbody>
  </table>
  <h2>Conflicts</h2>
  ${conflictCards || '<p class="sub">No conflicts in this snapshot.</p>'}
  <p class="foot">Generated ${new Date().toLocaleString("en-GB")} &middot; Engineering Resource Planner</p>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`);
    win.document.close();
  };

  return (
    <div>
      <p className="page-subtitle">
        The plan is versioned at most once per business day (Europe/Warsaw). The first plan change of the day creates a
        snapshot; later changes update the same snapshot.
      </p>

      <Card pad={false}>
        <Table
          rows={data.versions}
          rowKey={(v) => v.id}
          empty={<EmptyState title="No versions yet" hint="Generate or change a plan to create the first snapshot." />}
          columns={[
            { key: "date", header: "Snapshot date", render: (v) => <strong>{v.snapshotDate}</strong> },
            { key: "entries", header: "Plan entries", render: (v) => v.planEntriesCount },
            { key: "conflicts", header: "Conflicts", render: (v) => v.conflictsCount },
            { key: "updated", header: "Last updated", render: (v) => formatDateTime(v.updatedAt) },
            {
              key: "actions",
              header: "",
              render: (v) => (
                <Button size="sm" variant="secondary" onClick={() => void openVersion(v.id)}>
                  View snapshot
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={selected !== null || loadingVersion || versionError !== null}
        onClose={() => {
          setSelected(null);
          setVersionError(null);
        }}
        title="Plan snapshot"
        wide
      >
        {loadingVersion ? (
          <Spinner label="Loading snapshot…" />
        ) : versionError ? (
          <Alert tone="danger">{versionError}</Alert>
        ) : selected ? (
          <div className="print-area">
            <div className="flex-between mb-16">
              <p className="muted">
                Snapshot for <strong>{selected.snapshotDate}</strong> · {selected.planEntries.length} entries ·{" "}
                {selected.conflicts.length} conflicts
              </p>
              <Button variant="secondary" size="sm" className="no-print" onClick={() => printSnapshot(selected)}>
                Print to PDF
              </Button>
            </div>
            <div className="grid-2">
              <div>
                <h4 className="mb-16">Plan entries</h4>
                {selected.planEntries.length === 0 ? (
                  <p className="muted">No entries in this snapshot.</p>
                ) : (
                  <div className="table-scroll">
                    <Table
                      rows={selected.planEntries}
                      rowKey={(e) => `${e.taskId}-${e.userId}-${e.date}`}
                      columns={[
                        { key: "date", header: "Date", render: (e) => e.date },
                        { key: "code", header: "Task code", render: (e) => <span className={styles.taskCode}>{e.taskCode.split(".")[0]}</span> },
                        { key: "user", header: "Specialist", render: (e) => e.userName },
                        { key: "hours", header: "Hours", render: (e) => `${e.hours}h` },
                        { key: "lock", header: "", render: (e) => (e.locked ? <Badge tone="blue">manual</Badge> : <Badge tone="orange">auto</Badge>) },
                      ]}
                    />
                  </div>
                )}
              </div>
              <div>
                <h4 className="mb-16">Conflicts</h4>
                {selected.conflicts.length === 0 ? (
                  <p className="muted">No conflicts in this snapshot.</p>
                ) : (
                  <div className={styles.conflictList}>
                    {selected.conflicts.map((c, i) => (
                      <Card key={i} pad={false}>
                        <div className="flex" style={{ padding: "8px 12px" }}>
                          <Badge tone={severityTone(c.severity)}>{CONFLICT_SEVERITY_LABELS[c.severity]}</Badge>
                          <span>
                            <strong>{CONFLICT_TYPE_LABELS[c.type] ?? c.type}</strong> — {c.title}
                          </span>
                        </div>
                        <p className="muted" style={{ padding: "0 12px 8px", fontSize: 12 }}>
                          {c.description}
                        </p>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <div className={styles.adminPanel}>
        <Card>
          <h4 className="mb-16">Administration</h4>
          <div className="flex wrap">
            <Button variant="secondary" onClick={() => setConfirmReset(true)}>
              Reset database to seed
            </Button>
            <Button variant="danger" onClick={() => setConfirmWipe(true)}>
              Wipe all projects and tasks
            </Button>
            <span className="muted" style={{ fontSize: 12 }}>
              Wipe performs a soft delete. Deleted projects and tasks remain visible in the plan version history.
            </span>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset database to seed"
        message="This deletes all current data and restores the initial demo dataset (users, projects, tasks, availability)."
        confirmLabel="Reset to seed"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await resetDatabase();
          setConfirmReset(false);
        }}
      />

      <ConfirmDialog
        open={confirmWipe}
        title="Wipe all projects and tasks"
        message="All projects, tasks, dependencies, plan entries and conflicts will be soft-deleted. Version history is preserved."
        confirmLabel="Wipe everything"
        onCancel={() => setConfirmWipe(false)}
        onConfirm={async () => {
          await wipeAll();
          setConfirmWipe(false);
        }}
      />
    </div>
  );
}