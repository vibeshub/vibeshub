import { Link, useNavigate } from "react-router-dom";
import type { MouseEvent } from "react";
import type { TraceSummary } from "../types";

function IconPr() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="4" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M4 5.6v4.8M12 5v5.4a3 3 0 0 1-3 3M9 3h3v3" />
    </svg>
  );
}

function IconArrow() {
  return (
    <svg
      className="arrow"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 3l5 5-5 5" />
    </svg>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const ampm = hours >= 12 ? "PM" : "AM";
  return `${date}, ${h12}:${minutes} ${ampm}`;
}

interface Props {
  trace: TraceSummary;
  /** When true, show the repo chip in front of the PR ref (used on user page). */
  showRepoChip?: boolean;
  /** When true, show the uploader chip in meta (used on repo page). */
  showUploader?: boolean;
}

export function TraceListRow({ trace, showRepoChip, showUploader }: Props) {
  const navigate = useNavigate();
  const sizeKb = Math.max(1, Math.round(trace.byte_size / 1024));
  const [owner, repo] = trace.repo_full_name.split("/");
  const traceHref = `/${owner}/${repo}/pull/${trace.pr_number}/${trace.short_id}`;
  const repoHref = `/${owner}/${repo}`;
  const userHref = `/${trace.owner_login}`;

  const goTo = (href: string) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(href);
  };

  return (
    <Link className="trace-row" to={traceHref}>
      <div className="trace-icon">
        <IconPr />
      </div>
      <div className="trace-body">
        <div className="trace-row-top">
          {showRepoChip && (
            <button
              type="button"
              className="ref repo-ref"
              onClick={goTo(repoHref)}
            >
              {trace.repo_full_name}
            </button>
          )}
          <span className="ref">#{trace.pr_number}</span>
          <span className="trace-title">
            {trace.pr_title ?? `PR #${trace.pr_number}`}
          </span>
        </div>
        <div className="trace-meta">
          <span className="tool-tag">
            <span className="dot" />
            {trace.platform}
          </span>
          <span className="sep">·</span>
          <span>{trace.message_count} messages</span>
          <span className="sep">·</span>
          <span>{sizeKb} KB</span>
          {showUploader && (
            <>
              <span className="sep">·</span>
              <button
                type="button"
                className="uploader"
                onClick={goTo(userHref)}
              >
                <span className="av" />@{trace.owner_login}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="trace-row-right">
        <span className="when">{formatWhen(trace.created_at)}</span>
        <IconArrow />
      </div>
    </Link>
  );
}
