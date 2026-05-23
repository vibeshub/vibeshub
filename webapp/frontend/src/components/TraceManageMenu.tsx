import { useEffect, useId, useRef, useState } from "react";
import { ApiError, deleteTrace, patchTrace } from "../api";
import type { TracePatch, TraceSummary } from "../types";
import { RepoPrPicker } from "./RepoPrPicker";
import type { PickerSelection } from "./RepoPrPicker";
import styles from "./TraceManageMenu.module.css";

interface TraceManageMenuProps {
  trace: TraceSummary;
  /** Called with the updated summary after a successful PATCH. */
  onUpdated: (trace: TraceSummary) => void;
  /** Called after a successful DELETE so the parent can navigate away. */
  onDeleted: () => void;
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.body || `Request failed (${e.status})`;
  return e instanceof Error ? e.message : String(e);
}

function initialSelection(trace: TraceSummary): PickerSelection {
  if (trace.pr_url && trace.repo_full_name) {
    return {
      kind: "pr",
      prUrl: trace.pr_url,
      repoFullName: trace.repo_full_name,
    };
  }
  if (trace.repo_full_name) {
    return { kind: "repo", repoFullName: trace.repo_full_name };
  }
  return { kind: "none" };
}

function selectionToPatch(selection: PickerSelection): TracePatch {
  switch (selection.kind) {
    case "none":
      return { repo_full_name: null, pr_url: null };
    case "repo":
      return { repo_full_name: selection.repoFullName };
    case "pr":
      return { pr_url: selection.prUrl };
  }
}

function KeyIcon() {
  return (
    <svg
      className={styles.triggerIcon}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <circle cx="6" cy="10" r="2.7" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8.3 8.3 L13.5 3 M11 5.5 L12.5 7 M12.5 4 L14 5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TraceManageMenu({
  trace,
  onUpdated,
  onDeleted,
}: TraceManageMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<PickerSelection>(() =>
    initialSelection(trace),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const associated = trace.repo_full_name !== null;
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Reset transient sub-states when the popover closes.
  useEffect(() => {
    if (open) return;
    setEditing(false);
    setConfirmingDelete(false);
    setError(null);
  }, [open]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function togglePrivacy() {
    if (associated || busy) return;
    void run(async () => {
      const updated = await patchTrace(trace.short_id, {
        is_private: !trace.is_private,
      });
      onUpdated(updated);
    });
  }

  function applyAssociation() {
    if (busy) return;
    void run(async () => {
      const updated = await patchTrace(
        trace.short_id,
        selectionToPatch(selection),
      );
      onUpdated(updated);
      setEditing(false);
    });
  }

  function confirmDelete() {
    if (busy) return;
    void run(async () => {
      await deleteTrace(trace.short_id);
      onDeleted();
    });
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
      >
        <KeyIcon />
        <span className={styles.triggerLabel}>Owner</span>
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Manage trace"
          className={styles.popover}
        >
          <div className={styles.eyebrow}>
            <span>Manage trace</span>
            <span className={styles.eyebrowId}>{trace.short_id}</span>
          </div>

          <section className={styles.section}>
            <span className={styles.sectionLabel}>Visibility</span>
            <button
              type="button"
              className={styles.action}
              disabled={associated || busy}
              onClick={togglePrivacy}
            >
              <span className={styles.dot} data-state={trace.is_private ? "private" : "public"} />
              {trace.is_private ? "Make public" : "Make private"}
            </button>
            {associated && (
              <p className={styles.note}>
                Privacy mirrors GitHub for linked traces.
              </p>
            )}
          </section>

          <section className={styles.section}>
            <span className={styles.sectionLabel}>Association</span>
            {!editing ? (
              <button
                type="button"
                className={styles.action}
                disabled={busy}
                onClick={() => {
                  setSelection(initialSelection(trace));
                  setEditing(true);
                }}
              >
                Edit association
              </button>
            ) : (
              <div className={styles.editor}>
                <RepoPrPicker
                  value={selection}
                  onChange={setSelection}
                  disabled={busy}
                />
                <div className={styles.editorActions}>
                  <button
                    type="button"
                    className={styles.actionPrimary}
                    disabled={busy}
                    onClick={applyAssociation}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className={styles.actionGhost}
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className={styles.section}>
            <span className={styles.sectionLabel}>Danger zone</span>
            {!confirmingDelete ? (
              <button
                type="button"
                className={styles.danger}
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete trace
              </button>
            ) : (
              <div className={styles.confirm}>
                <span className={styles.confirmText}>
                  Delete this trace? This cannot be undone.
                </span>
                <div className={styles.editorActions}>
                  <button
                    type="button"
                    className={styles.dangerFilled}
                    disabled={busy}
                    onClick={confirmDelete}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    className={styles.actionGhost}
                    disabled={busy}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </div>
  );
}
