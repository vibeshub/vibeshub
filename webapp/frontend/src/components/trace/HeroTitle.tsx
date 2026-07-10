import { useState } from "react";
import { ApiError, patchTrace } from "../../api";
import type { TraceSummary } from "../../types";

interface Props {
  trace: TraceSummary;
  /** Derived AI title from the parsed session, used as a fallback. */
  aiTitle: string | null;
  /**
   * First user prompt. Used as a last-resort derived title for traces that
   * carry no `ai-title` record (e.g. Codex rollouts, terminal exports), which
   * would otherwise all read "Untitled session". Mirrors how Codex's own
   * session picker labels sessions by their first message.
   */
  firstPrompt: string | null;
  canEdit: boolean;
  onUpdated: (trace: TraceSummary) => void;
}

const MAX_TITLE = 200;
// Keep the derived hero title to roughly one line at the 42px heading size.
const FALLBACK_MAX = 80;

// Turn a raw first prompt into a one-line title: collapse whitespace and, when
// long, truncate at a word boundary with an ellipsis. Returns null for blanks.
function titleFromPrompt(prompt: string | null): string | null {
  if (!prompt) return null;
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= FALLBACK_MAX) return clean;
  const slice = clean.slice(0, FALLBACK_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}

export type TitleSource = "custom" | "ai" | "pr" | "digest" | "prompt" | "none";

// Where the H1 comes from, in preference order. The verbatim prompt is the
// last resort: a PR title or the digest's ask reads as a title, a raw prompt
// truncated mid-sentence does not.
export function titleSource(
  trace: TraceSummary,
  aiTitle: string | null,
  firstPrompt: string | null,
): TitleSource {
  if (trace.title) return "custom";
  if (aiTitle) return "ai";
  if (trace.pr_title) return "pr";
  if (titleFromPrompt(trace.ai_digest?.ask ?? null)) return "digest";
  if (titleFromPrompt(firstPrompt)) return "prompt";
  return "none";
}

function displayTitle(
  trace: TraceSummary,
  aiTitle: string | null,
  firstPrompt: string | null,
): string {
  switch (titleSource(trace, aiTitle, firstPrompt)) {
    case "custom":
      return trace.title!;
    case "ai":
      return aiTitle!;
    case "pr":
      return trace.pr_title!;
    case "digest":
      return titleFromPrompt(trace.ai_digest!.ask)!;
    case "prompt":
      return titleFromPrompt(firstPrompt)!;
    default:
      return "Untitled session";
  }
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.body || `Request failed (${e.status})`;
  return e instanceof Error ? e.message : String(e);
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <path
        d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeroTitle({
  trace,
  aiTitle,
  firstPrompt,
  canEdit,
  onUpdated,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setValue(trace.title ?? "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await patchTrace(trace.short_id, { title: value });
      onUpdated(updated);
      setEditing(false);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="hero-title-edit">
        <input
          className="hero-title-input"
          type="text"
          aria-label="Session title"
          value={value}
          maxLength={MAX_TITLE}
          placeholder="Add a title"
          autoFocus
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="hero-title-actions">
          <button
            type="button"
            className="hero-title-btn primary"
            disabled={busy}
            onClick={() => void save()}
          >
            Save
          </button>
          <button
            type="button"
            className="hero-title-btn"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
        {error && (
          <span className="hero-title-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="hero-title-row">
      <h1 className="hero-title">
        {displayTitle(trace, aiTitle, firstPrompt)}
      </h1>
      {canEdit && (
        <button
          type="button"
          className="hero-title-edit-btn"
          aria-label="Edit title"
          onClick={startEditing}
        >
          <PencilIcon />
        </button>
      )}
    </div>
  );
}
