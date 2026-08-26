import { useState } from "react";
import styles from "./ui.module.css";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className={styles.spinnerWrap}>
      <div className={styles.spinner} role="status" aria-label="Loading" />
      {label ? <span className="muted">{label}</span> : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className={styles.emptyState}>
      <strong>{title}</strong>
      {hint ? <span className="muted">{hint}</span> : null}
    </div>
  );
}

export function StatCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "blue" | "orange" | "green" | "red" }) {
  return (
    <div className={`${styles.statCard} ${tone ? styles[`stat-${tone}`] : ""}`}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  return (
    <div className={styles.modalOverlay} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.modalHeader}>
          <h3>{title}</h3>
        </div>
        <div className={styles.modalBody}>
          <p>{message}</p>
          {error ? (
            <p className={styles.confirmError} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.modalActions}>
            <button
              className={`${styles.button} ${styles.secondary}`}
              onClick={() => {
                setError(null);
                onCancel();
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className={`${styles.button} ${styles.danger}`}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onConfirm();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Action failed");
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              {busy ? "Working..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}