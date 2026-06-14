import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../ThemeToggle";
import type { Session } from "./types";
import { IconLink } from "./icons";

interface Props {
  session: Session;
  repoOwner?: string;
  repoName?: string;
  /** Optional owner-only controls rendered in the actions row. */
  ownerControls?: ReactNode;
}

export function ViewerTopbar({
  session,
  repoOwner,
  repoName,
  ownerControls,
}: Props) {
  const meta = session.meta;
  const id = meta.sessionId ? meta.sessionId.slice(0, 8) : "";

  const copyLink = () => {
    if (typeof window === "undefined") return;
    void window.navigator.clipboard
      ?.writeText(window.location.href)
      .catch(() => undefined);
  };

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
          <button
            className="iconbtn"
            onClick={copyLink}
            type="button"
            aria-label="Copy share link"
          >
            <IconLink />
            <span className="share-label">Share</span>
          </button>
        </div>
      </div>
    </header>
  );
}
