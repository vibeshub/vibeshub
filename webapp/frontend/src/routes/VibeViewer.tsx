import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, claimTrace, fetchTrace, uploadTrace } from "../api";
import { useAuth } from "../auth/AuthContext";
import { LoadingState } from "../components/LoadingState";
import { PageTopbar } from "../components/PageTopbar";
import { SeoHead } from "../components/SeoHead";
import {
  looksLikeTerminalExport,
  terminalExportToJsonl,
} from "../components/trace/terminalExport";
import type { TraceSummary } from "../types";

// A polished public trace linked as a "see it in action" example for cold
// visitors (e.g. Google Ads) who don't have a transcript handy yet.
const EXAMPLE_TRACE_PATH = "/t/fxz7sbokor";

// Anonymous uploads come back with a one-time claim token. We stash it in
// localStorage keyed by short id so it survives the GitHub OAuth round trip and
// the trace can later be linked to the signer's profile.
const CLAIM_NS = "vibeshub.claim.";

function storeClaimToken(shortId: string, token: string) {
  try {
    window.localStorage.setItem(CLAIM_NS + shortId, token);
  } catch {
    // localStorage may throw in sandboxed contexts; the claim is best-effort.
  }
}
function readClaimToken(shortId: string): string | null {
  try {
    return window.localStorage.getItem(CLAIM_NS + shortId);
  } catch {
    return null;
  }
}
function clearClaimToken(shortId: string) {
  try {
    window.localStorage.removeItem(CLAIM_NS + shortId);
  } catch {
    // ignore
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function errMessage(err: unknown): string {
  if (err instanceof ApiError) return err.body || `Upload failed (${err.status})`;
  if (err instanceof Error) return err.message;
  return String(err);
}

// A single drop can carry the main transcript plus an optional subagents zip;
// classify by extension so the user never has to use two file pickers.
function classify(files: File[]): {
  transcript: File | null;
  subagents: File | null;
} {
  let transcript: File | null = null;
  let subagents: File | null = null;
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (n.endsWith(".zip")) subagents = subagents ?? f;
    else if (n.endsWith(".jsonl") || n.endsWith(".json") || n.endsWith(".txt"))
      transcript = transcript ?? f;
  }
  return { transcript, subagents };
}

type Stage = "idle" | "uploading" | "success";
type ClaimState = "none" | "claiming" | "claimed" | "error";

interface SuccessData {
  shortId: string;
  summary: TraceSummary | null;
  fileName: string;
  claimToken: string | null;
}

export function VibeViewer() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [stage, setStage] = useState<Stage>("idle");
  const [dragover, setDragover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [upName, setUpName] = useState("session.jsonl");
  const [upMeta, setUpMeta] = useState("preparing…");
  const [progress, setProgress] = useState(0);

  const [success, setSuccess] = useState<SuccessData | null>(null);
  const [promptCopy, setPromptCopy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [claimState, setClaimState] = useState<ClaimState>("none");
  const [flashCard, setFlashCard] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressTimer = useRef<number | null>(null);
  const copyTimer = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (progressTimer.current) window.clearInterval(progressTimer.current);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  // The "no transcript handy?" bridge links jump to the matching how-to card
  // and flash it, so the connection between the prompt and the instructions is
  // obvious. Honours reduced-motion for the scroll.
  const jumpToCard = useCallback((id: string) => {
    const el = document.getElementById(id);
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }
    setFlashCard(id);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashCard(null), 1700);
  }, []);

  // Returning from OAuth with ?claim=<shortId> (and a stored token) → link the
  // anonymous trace to the now signed-in profile, then open it.
  const claimSid = searchParams.get("claim");
  const claiming = Boolean(claimSid) && !authLoading && Boolean(user);
  useEffect(() => {
    if (!claimSid || authLoading || !user) return;
    const token = readClaimToken(claimSid);
    let cancelled = false;
    (async () => {
      try {
        if (token) await claimTrace(claimSid, token);
      } catch {
        // Already claimed or token expired — fall through to just opening it.
      } finally {
        clearClaimToken(claimSid);
        if (!cancelled) navigate(`/t/${claimSid}`, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimSid, authLoading, user, navigate]);

  function beginProgress(sizeLabel: string) {
    setProgress(0);
    setUpMeta(sizeLabel);
    if (progressTimer.current) window.clearInterval(progressTimer.current);
    progressTimer.current = window.setInterval(() => {
      // Optimistic climb to ~90% while the request is in flight; the real
      // completion jumps it to 100%.
      setProgress((p) => Math.min(90, p + Math.random() * 14 + 6));
    }, 240);
  }
  function endProgress() {
    if (progressTimer.current) {
      window.clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    setProgress(100);
  }

  const handleFiles = useCallback(async (files: File[]) => {
    const { transcript, subagents } = classify(files);
    if (!transcript) {
      setError(
        "Drop a .jsonl session file or a .txt export from Claude Code (a .zip of subagents is optional).",
      );
      return;
    }
    setError(null);

    // A .txt is Claude Code's rendered terminal export. Convert it to a
    // synthetic .jsonl the viewer reads, and archive the raw .txt alongside.
    let toUpload: File = transcript;
    let sourceExport: File | null = null;
    if (transcript.name.toLowerCase().endsWith(".txt")) {
      const text = await transcript.text();
      if (!looksLikeTerminalExport(text)) {
        setError(
          "This .txt does not look like a Claude Code export. Upload the .jsonl session file instead.",
        );
        return;
      }
      const { jsonl, recovered } = terminalExportToJsonl(text);
      if (!recovered) {
        setError(
          "Could not reconstruct this text export. For a full trace, upload the .jsonl session file at ~/.claude/projects/<session>.jsonl.",
        );
        return;
      }
      toUpload = new File(
        [jsonl],
        transcript.name.replace(/\.txt$/i, ".jsonl"),
        { type: "application/jsonl" },
      );
      sourceExport = transcript;
    }

    setUpName(transcript.name);
    setStage("uploading");
    const sizeLabel = subagents
      ? `${formatBytes(transcript.size)} + subagents`
      : formatBytes(transcript.size);
    beginProgress(sizeLabel);

    try {
      const result = await uploadTrace({
        transcript: toUpload,
        subagents,
        sourceExport,
        isPrivate: false,
      });
      if (result.claim_token)
        storeClaimToken(result.short_id, result.claim_token);
      const summary = await fetchTrace(result.short_id).catch(() => null);
      endProgress();
      window.setTimeout(() => {
        setSuccess({
          shortId: result.short_id,
          summary,
          fileName: transcript.name,
          claimToken: result.claim_token ?? null,
        });
        setClaimState(result.claim_token ? "none" : "claimed");
        setStage("success");
        setPromptCopy(true);
        setCopied(false);
      }, 360);
    } catch (err) {
      if (progressTimer.current) window.clearInterval(progressTimer.current);
      progressTimer.current = null;
      setStage("idle");
      setError(errMessage(err));
    }
  }, []);

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length) void handleFiles(files);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragover(false);
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) void handleFiles(files);
  }

  function uploadAnother() {
    setStage("idle");
    setSuccess(null);
    setError(null);
    setPromptCopy(false);
    setCopied(false);
    setClaimState("none");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const shareUrl = success
    ? `${window.location.origin}/t/${success.shortId}`
    : "";

  function doCopy() {
    if (!success) return;
    if (navigator.clipboard) navigator.clipboard.writeText(shareUrl).catch(() => {});
    setPromptCopy(false);
    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1700);
  }

  async function claimNow() {
    if (!success?.claimToken) return;
    setClaimState("claiming");
    try {
      await claimTrace(success.shortId, success.claimToken);
      clearClaimToken(success.shortId);
      setClaimState("claimed");
    } catch {
      setClaimState("error");
    }
  }

  const seo = (
    <SeoHead
      title="Claude Code trace viewer"
      description="Drop a Claude Code transcript and get a clean, replayable, shareable trace in seconds. No login required, secrets redacted on upload."
      path="/vibeviewer"
      image="https://vibeshub.ai/og-vibeviewer.png"
    />
  );

  if (claiming) {
    return (
      <div className="page-shell vv-page">
        {seo}
        <PageTopbar crumbs={[{ label: "vibeviewer", current: true }]} />
        <LoadingState label="Linking this trace to your profile…" />
      </div>
    );
  }

  const subText =
    success?.summary &&
    [
      success.summary.title || "Untitled session",
      `${success.summary.message_count} msgs`,
      success.summary.platform,
    ].join(" · ");

  return (
    <div className="page-shell vv-page">
      {seo}
      <PageTopbar crumbs={[{ label: "vibeviewer", current: true }]} />

      <main className="vv">
        <span className="vv-eyebrow">
          <span className="dot" /> Claude Code trace viewer · no account needed
        </span>

        <h1 className="vv-title">
          Your vibe coding sessions, <span className="hl">visualized</span>.
        </h1>
        <p className="vv-sub">
          Your hard work deserves a better look. Drop a Claude Code transcript
          and get a clean, replayable, shareable trace in seconds, no login
          required.
        </p>

        <div className="vv-stage">
          {stage === "idle" && (
            <div
              className={`dropzone${dragover ? " dragover" : ""}`}
              role="button"
              tabIndex={0}
              aria-label="Upload a transcript"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragover(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragover(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragover(false);
              }}
              onDrop={onDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".jsonl,.json,.txt,.zip"
                multiple
                hidden
                onChange={onInputChange}
              />
              <div className="dz-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 16V4" />
                  <path d="m7 9 5-5 5 5" />
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
              </div>
              <div className="dz-title">Drop your transcript here</div>
              <div className="dz-sub">
                or <span className="browse">browse files</span> ·{" "}
                <span className="mono">.jsonl</span> or{" "}
                <span className="mono">.txt</span> from Claude Code
              </div>
              <div className="dz-chips">
                <span className="dz-chip">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 4v4l2.5 1.5" />
                    <circle cx="8" cy="8" r="6" />
                  </svg>{" "}
                  ready in seconds
                </span>
                <span className="dz-chip">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6.5 8.5 3 12s-1.5-.5-1.5-2 4-5.5 6.5-5.5" />
                    <path d="M9.5 7.5 13 4s1.5.5 1.5 2-4 5.5-6.5 5.5" />
                  </svg>{" "}
                  instant public link
                </span>
                <span className="dz-chip">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8 1.5 2.5 4v3.5c0 3.4 2.3 5.6 5.5 6.5 3.2-.9 5.5-3.1 5.5-6.5V4L8 1.5z" />
                  </svg>{" "}
                  up to 50 MB
                </span>
              </div>
            </div>
          )}

          {stage === "uploading" && (
            <div className="vv-uploading">
              <div className="up-file">
                <span className="fic">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                </span>
                <div>
                  <div className="up-name">{upName}</div>
                  <div className="up-meta">{upMeta}</div>
                </div>
              </div>
              <div className="up-track">
                <div className="up-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="up-status">
                <span>{Math.floor(progress)}%</span>
                <span>
                  {progress >= 100
                    ? "done"
                    : progress >= 60
                      ? "redacting secrets"
                      : "uploading"}
                </span>
              </div>
            </div>
          )}

          {stage === "success" && success && (
            <div className="vv-success">
              <div className="sx-top">
                <span className="sx-check">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m4 12 5 5L20 6" />
                  </svg>
                </span>
                <div className="sx-titles">
                  <div className="sx-title">Your trace is live</div>
                  <div className="sx-sub">{subText || success.fileName}</div>
                </div>
                <span className="pv-badge public">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18" />
                    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
                  </svg>
                  public
                </span>
              </div>

              <div className="sx-share">
                <div className="sx-share-label">Shareable link</div>
                <div
                  className={`share-row${promptCopy ? " prompt" : ""}`}
                  title="Click to copy"
                  onClick={doCopy}
                  onMouseEnter={() => promptCopy && setPromptCopy(false)}
                >
                  <div className="share-tip">
                    {copied
                      ? "Copied to clipboard ✓"
                      : promptCopy
                        ? "Copy your link"
                        : "Copy to clipboard"}
                  </div>
                  <div className="share-url">
                    <span className="host">{window.location.host}/t/</span>
                    <span className="slug">{success.shortId}</span>
                  </div>
                  <button
                    className={`copy-btn${copied ? " ok" : ""}`}
                    type="button"
                    aria-label={copied ? "Link copied" : "Copy link"}
                    onClick={(e) => {
                      e.stopPropagation();
                      doCopy();
                    }}
                  >
                    {copied ? (
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m3 8.5 3 3 7-7" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="5" y="5" width="9" height="9" rx="1.5" />
                        <path d="M3 11V3a1 1 0 0 1 1-1h7" />
                      </svg>
                    )}
                    <span>{copied ? "Copied!" : "Copy"}</span>
                  </button>
                </div>
                <div className="sx-hint">
                  Anyone with the link can view this trace.
                </div>
              </div>

              <div className="sx-actions">
                <Link className="btn primary" to={`/t/${success.shortId}`}>
                  Open trace
                  <svg
                    className="arrow"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </Link>

                {renderClaimAction({
                  claimable: Boolean(success.claimToken),
                  signedIn: Boolean(user),
                  claimState,
                  shortId: success.shortId,
                  onClaim: claimNow,
                })}

                <button
                  className="btn ghost"
                  type="button"
                  style={{ marginLeft: "auto" }}
                  onClick={uploadAnother}
                >
                  Upload another
                </button>
              </div>
            </div>
          )}
        </div>

        {stage === "idle" && (
          <p className="vv-bridge">
            No transcript handy? Get one with{" "}
            <button
              type="button"
              className="bridge-link"
              aria-label="Jump to the /export instructions below"
              onClick={() => jumpToCard("how-export")}
            >
              /export
            </button>
            , a{" "}
            <button
              type="button"
              className="bridge-link"
              aria-label="Jump to the local session file instructions below"
              onClick={() => jumpToCard("how-local")}
            >
              local .jsonl
            </button>
            , or the{" "}
            <button
              type="button"
              className="bridge-link"
              aria-label="Jump to the plugin instructions below"
              onClick={() => jumpToCard("how-plugin")}
            >
              plugin
            </button>
            .
          </p>
        )}

        {stage === "idle" && (
          <p className="vv-example">
            Want to see it in action?{" "}
            <a
              className="bridge-link"
              href={EXAMPLE_TRACE_PATH}
              target="_blank"
              rel="noopener noreferrer"
            >
              Watch a live example
            </a>
            .
          </p>
        )}

        {error && <p className="vv-error">{error}</p>}

        {stage !== "success" && (
          <div className="vv-nudge">
            <svg viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>
              {user ? (
                <>Signed in as @{user.login}. Your uploads link to your profile.</>
              ) : (
                <>
                  <a href={loginHref("/vibeviewer")}>Sign in</a> to show it on
                  your profile.
                </>
              )}
            </span>
          </div>
        )}

        <div className="vv-trust">
          <span className="pt">
            <TrustCheck /> No account required
          </span>
          <span className="sep">·</span>
          <span className="pt">
            <TrustCheck /> Secrets redacted on upload
          </span>
        </div>

        <HowToSection flashCard={flashCard} />

        <div className="vv-foot">vibeshub · vibeviewer</div>
      </main>
    </div>
  );
}

function loginHref(next: string): string {
  return `/api/auth/github/login?next=${encodeURIComponent(next)}`;
}

function TrustCheck() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 8.5 2.5 2.5L12 5" />
    </svg>
  );
}

function GithubGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function renderClaimAction(opts: {
  claimable: boolean;
  signedIn: boolean;
  claimState: ClaimState;
  shortId: string;
  onClaim: () => void;
}) {
  const { claimable, signedIn, claimState, shortId, onClaim } = opts;

  if (claimState === "claimed") {
    return (
      <button className="btn ghost" type="button" disabled>
        <TrustCheck /> On your profile
      </button>
    );
  }
  if (!claimable) return null;

  if (!signedIn) {
    return (
      <a className="btn ghost" href={loginHref(`/vibeviewer?claim=${shortId}`)}>
        <GithubGlyph /> Sign in to claim it
      </a>
    );
  }
  return (
    <button
      className="btn ghost"
      type="button"
      onClick={onClaim}
      disabled={claimState === "claiming"}
    >
      <GithubGlyph />
      {claimState === "claiming"
        ? "Claiming…"
        : claimState === "error"
          ? "Retry claim"
          : "Claim to your profile"}
    </button>
  );
}

// ---- "Three ways to get your transcript" ----

interface CodeLine {
  text: string;
  kind?: "cmt" | "cmd" | "str";
}

function CodeCopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return (
    <button
      className={`how-copy${ok ? " ok" : ""}`}
      type="button"
      onClick={() => {
        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
        setOk(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setOk(false), 1600);
      }}
    >
      {ok ? (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3 8.5 3 3 7-7" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="5" width="9" height="9" rx="1.5" />
          <path d="M3 11V3a1 1 0 0 1 1-1h7" />
        </svg>
      )}
      {ok ? "Copied" : "Copy"}
    </button>
  );
}

function FileGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
function ZipGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 3h8l2 2v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function CodeBlock({ lines }: { lines: CodeLine[] }) {
  return (
    <pre>
      {lines.map((l, i) => (
        <span key={i}>
          {l.kind ? <span className={l.kind}>{l.text}</span> : l.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

const WAY2_FULL = `# Search your sessions for a phrase you remember
grep -ril "fix the navbar" ~/.claude/projects/

# ...or just grab the newest session
ls -t ~/.claude/projects/*/*.jsonl | head

# Then optionally bundle that session's subagents
SESSION=~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
zip -j ~/vibeshub-subagents.zip "\${SESSION%.jsonl}"/subagents/* 2>/dev/null \\
  && echo "wrote ~/vibeshub-subagents.zip" || echo "no subagents for this session"`;

const WAY3_FULL = `/plugin marketplace add vibeshub/vibeshub
/plugin install vibeshub@vibeshub`;

function HowToSection({ flashCard }: { flashCard: string | null }) {
  const flash = (id: string) => (flashCard === id ? " flash" : "");
  return (
    <section className="vv-how">
      <div className="vv-how-head">
        <div className="vv-how-eyebrow">Don't have a file yet?</div>
        <h2 className="vv-how-title">Three ways to get your transcript</h2>
        <p className="vv-how-sub">
          Grab a quick text export, pull the full local session file, or let the
          plugin do it for you on every PR.
        </p>
      </div>

      <div className="how-grid">
        {/* Way 1 */}
        <article id="how-export" className={`how-card${flash("how-export")}`}>
          <div className="how-card-body">
            <div className="how-top">
              <span className="how-num">1</span>
              <span className="how-name">/export</span>
              <span className="how-tag easy">Easiest</span>
            </div>
            <p className="how-desc">
              In Claude Code, run <span className="em">/export</span> and save
              the conversation to a file. Upload that{" "}
              <span className="em">.txt</span> here and we reconstruct a viewable
              trace.
              <span className="how-note">
                Least detail. Text exports drop token counts, timings, thinking,
                and subagent detail, so it is a best-effort reconstruction.
              </span>
            </p>
          </div>
          <div className="how-code">
            <CodeCopyButton text="/export" />
            <CodeBlock
              lines={[
                { text: "# In Claude Code, then save the .txt", kind: "cmt" },
                { text: "/export", kind: "cmd" },
              ]}
            />
          </div>
          <div className="how-fields">
            <span className="pill">
              <FileGlyph /> .txt
            </span>
            <span>→ transcript field</span>
          </div>
        </article>

        {/* Way 2 */}
        <article id="how-local" className={`how-card${flash("how-local")}`}>
          <div className="how-card-body">
            <div className="how-top">
              <span className="how-num">2</span>
              <span className="how-name">Local session files</span>
              <span className="how-tag rich">Richest</span>
            </div>
            <p className="how-desc">
              Claude Code keeps a full <span className="em">.jsonl</span>{" "}
              transcript of every session on your machine: token usage, timings,
              thinking, tool I/O, and subagents.
              <span className="how-note">
                They live under <span className="em">~/.claude/projects/</span>,
                one folder per project. Not sure which file? Search them for a
                phrase you remember, or grab the newest, then upload that .jsonl
                (optionally with a .zip of its subagents).
              </span>
            </p>
          </div>
          <div className="how-code">
            <CodeCopyButton text={WAY2_FULL} />
            <CodeBlock
              lines={[
                { text: "# Search for a phrase you remember", kind: "cmt" },
                { text: 'grep -ril "fix the navbar" ~/.claude/projects/', kind: "cmd" },
                { text: "" },
                { text: "# ...or just grab the newest session", kind: "cmt" },
                { text: "ls -t ~/.claude/projects/*/*.jsonl | head", kind: "cmd" },
                { text: "" },
                { text: "# Optional: bundle subagents", kind: "cmt" },
                { text: 'zip -j subagents.zip "<session>"/subagents/*', kind: "cmd" },
              ]}
            />
          </div>
          <div className="how-fields">
            <span className="pill">
              <FileGlyph /> .jsonl
            </span>
            <span className="pill opt">
              <ZipGlyph /> .zip optional
            </span>
          </div>
        </article>

        {/* Way 3 */}
        <article
          id="how-plugin"
          className={`how-card featured${flash("how-plugin")}`}
        >
          <div className="how-card-body">
            <div className="how-top">
              <span className="how-num">3</span>
              <span className="how-name">vibeshub plugin</span>
              <span className="how-tag rec">Recommended</span>
            </div>
            <p className="how-desc">
              Install once and it captures and uploads sessions for you, nothing
              to hunt down. Uploads automatically when you open or update a PR,
              and you can share on demand with{" "}
              <span className="em">/share-trace</span>.
              <span className="how-note">
                Because it uses your <span className="em">gh</span> identity,
                plugin uploads land on your profile automatically.
              </span>
            </p>
          </div>
          <div className="how-code">
            <CodeCopyButton text={WAY3_FULL} />
            <CodeBlock
              lines={[
                { text: "# Install the plugin", kind: "cmt" },
                { text: "/plugin marketplace add vibeshub/vibeshub", kind: "cmd" },
                { text: "/plugin install vibeshub@vibeshub", kind: "cmd" },
                { text: "" },
                { text: "# Then, any time:", kind: "cmt" },
                { text: "/share-trace", kind: "cmd" },
              ]}
            />
          </div>
          <div className="how-fields">
            <span>
              Needs <span style={{ color: "var(--text-muted)" }}>gh</span> (run{" "}
              <span style={{ color: "var(--text-muted)" }}>gh auth login</span>)
              &amp; <span style={{ color: "var(--text-muted)" }}>python3</span>{" "}
              on PATH
            </span>
          </div>
        </article>
      </div>
    </section>
  );
}
