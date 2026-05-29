import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, uploadTrace } from "../api";
import { AuthWidget } from "../components/AuthWidget";
import { LoadingState } from "../components/LoadingState";
import { PageTopbar } from "../components/PageTopbar";
import { RepoPrPicker } from "../components/RepoPrPicker";
import type { PickerSelection } from "../components/RepoPrPicker";
import { SeoHead } from "../components/SeoHead";
import {
  looksLikeTerminalExport,
  terminalExportToJsonl,
} from "../components/trace/terminalExport";
import { useAuth } from "../auth/AuthContext";
import styles from "./UploadPage.module.css";

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "error"; message: string };

export function UploadPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [transcript, setTranscript] = useState<File | null>(null);
  const [subagents, setSubagents] = useState<File | null>(null);
  const [selection, setSelection] = useState<PickerSelection>({
    kind: "none",
  });
  const [isPrivate, setIsPrivate] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (loading) return <LoadingState label="Loading…" />;

  const seo = (
    <SeoHead
      title="Upload a trace"
      description="Upload a Claude Code session transcript and share the trace."
      path="/upload"
      noindex
    />
  );

  if (!user) {
    return (
      <div className="page-shell">
        {seo}
        <PageTopbar crumbs={[{ label: "upload", current: true }]} />
        <main className={styles.page}>
          <div className={styles.signin}>
            <h1>Upload a trace</h1>
            <p>
              Sign in with GitHub to upload a Claude Code session trace from
              your browser.
            </p>
            <AuthWidget />
          </div>
        </main>
      </div>
    );
  }

  const associated = selection.kind !== "none";
  const uploading = status.kind === "uploading";
  const canSubmit = transcript !== null && !uploading;

  // Clear any stale upload error once the user adjusts the form inputs.
  function clearError() {
    setStatus((s) => (s.kind === "error" ? { kind: "idle" } : s));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transcript) return;
    setStatus({ kind: "uploading" });

    // A .txt is Claude Code's rendered terminal export. Convert it to a
    // synthetic .jsonl the viewer can read, and keep the raw .txt to archive.
    let toUpload: File = transcript;
    let sourceExport: File | null = null;
    if (transcript.name.toLowerCase().endsWith(".txt")) {
      const text = await transcript.text();
      if (!looksLikeTerminalExport(text)) {
        setStatus({
          kind: "error",
          message:
            "This .txt does not look like a Claude Code export. Upload the .jsonl session file instead.",
        });
        return;
      }
      const { jsonl, recovered } = terminalExportToJsonl(text);
      if (!recovered) {
        setStatus({
          kind: "error",
          message:
            "Could not reconstruct this text export. For a full trace, upload the .jsonl session file at ~/.claude/projects/<session>.jsonl.",
        });
        return;
      }
      toUpload = new File(
        [jsonl],
        transcript.name.replace(/\.txt$/i, ".jsonl"),
        { type: "application/jsonl" },
      );
      sourceExport = transcript;
    }

    try {
      const result = await uploadTrace({
        transcript: toUpload,
        subagents,
        sourceExport,
        isPrivate: selection.kind === "none" ? isPrivate : false,
        prUrl: selection.kind === "pr" ? selection.prUrl : null,
        repoFullName:
          selection.kind === "repo"
            ? selection.repoFullName
            : selection.kind === "pr"
              ? selection.repoFullName
              : null,
      });
      navigate(`/t/${result.short_id}`);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.body || `Upload failed (${err.status})`
          : err instanceof Error
            ? err.message
            : String(err);
      setStatus({ kind: "error", message });
    }
  }

  return (
    <div className="page-shell">
      {seo}
      <PageTopbar crumbs={[{ label: "upload", current: true }]} />
      <main className={styles.page}>
        <form className={styles.form} onSubmit={onSubmit}>
          <h1 className={styles.title}>Upload a trace</h1>
          <p className={styles.lede}>
            Share a Claude Code session by uploading its transcript.
          </p>

          <div className={styles.field}>
            <label htmlFor="transcript-input" className={styles.label}>
              Transcript file (.jsonl, or a .txt export)
            </label>
            <input
              id="transcript-input"
              type="file"
              accept=".jsonl,.txt"
              disabled={uploading}
              onChange={(e) => {
                setTranscript(e.target.files?.[0] ?? null);
                clearError();
              }}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="subagents-input" className={styles.label}>
              Subagents archive (.zip, optional)
            </label>
            <input
              id="subagents-input"
              type="file"
              accept=".zip"
              disabled={uploading}
              onChange={(e) => {
                setSubagents(e.target.files?.[0] ?? null);
                clearError();
              }}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Link a repo or PR (optional)</span>
            <RepoPrPicker
              value={selection}
              onChange={(next) => {
                setSelection(next);
                clearError();
              }}
              disabled={uploading}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={associated ? false : isPrivate}
                disabled={associated || uploading}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              <span>Make this trace private</span>
            </label>
            {associated ? (
              <p className={styles.note}>
                Privacy mirrors the linked GitHub repository — this trace is
                public if the repo is public, private if it is private.
              </p>
            ) : (
              <p className={styles.note}>
                Standalone traces are public unless you mark them private.
              </p>
            )}
          </div>

          {status.kind === "error" && (
            <p className={styles.error}>{status.message}</p>
          )}

          <button
            type="submit"
            className={styles.submit}
            disabled={!canSubmit}
          >
            {uploading ? "Uploading…" : "Upload trace"}
          </button>
        </form>
      </main>
    </div>
  );
}
