import { useState } from "react";
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

export function TraceManageMenu({
  trace,
  onUpdated,
  onDeleted,
}: TraceManageMenuProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<PickerSelection>(() =>
    initialSelection(trace),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const associated = trace.repo_full_name !== null;

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
    <div className={styles.menu}>
      <span className={styles.heading}>Manage trace</span>

      <div className={styles.section}>
        <button
          type="button"
          className={styles.action}
          disabled={associated || busy}
          onClick={togglePrivacy}
        >
          {trace.is_private ? "Make public" : "Make private"}
        </button>
        {associated && (
          <p className={styles.note}>Privacy mirrors GitHub for linked traces.</p>
        )}
      </div>

      <div className={styles.section}>
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
                className={styles.action}
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
      </div>

      <div className={styles.section}>
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
            <span>Delete this trace? This cannot be undone.</span>
            <div className={styles.editorActions}>
              <button
                type="button"
                className={styles.danger}
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
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
