import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../ThemeToggle";
import type { TraceSummary } from "../../types";
import type { Session } from "./types";
import { IconX } from "./icons";
import { tweetIntentUrl } from "./share";

interface Props {
  session: Session;
  trace: TraceSummary;
  repoOwner?: string;
  repoName?: string;
  /** Optional owner-only controls rendered in the actions row. */
  ownerControls?: ReactNode;
}

export function ViewerTopbar({
  session,
  trace,
  repoOwner,
  repoName,
  ownerControls,
}: Props) {
  const meta = session.meta;
  const id = meta.sessionId ? meta.sessionId.slice(0, 8) : "";

  // A public trace link is a shareable artifact: posting it to X renders the
  // per-trace social card. Private traces are gated, so sharing them is
  // pointless and we hide the affordance.
  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareHref = trace.is_private ? null : tweetIntentUrl(trace, pageUrl);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" to="/" style={{ textDecoration: "none" }}>
          <span className="brand-mark">v</span>
          <span>vibeshub</span>
        </Link>
        {repoOwner && (
          <>
            <span className="brand-sep viewer-crumb-owner">/</span>
            <Link
              className="topbar-link viewer-crumb-owner"
              to={`/${repoOwner}`}
            >
              {repoOwner}
            </Link>
          </>
        )}
        {repoOwner && repoName && (
          <>
            <span className="brand-sep">/</span>
            <Link
              className="topbar-link"
              to={`/${repoOwner}/${repoName}`}
            >
              {repoName}
            </Link>
          </>
        )}
        <span className="brand-sep">/</span>
        <span className="brand-trace">trace/{id}</span>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          {ownerControls}
          <ThemeToggle />
          {shareHref && (
            <a
              className="iconbtn"
              href={shareHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share on X"
            >
              <IconX />
              <span className="share-label">Share</span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
