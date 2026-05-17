import { Link } from "react-router-dom";
import type { Session } from "./types";
import { IconLink, IconMoon, IconSun } from "./icons";
import { useTheme } from "./theme";

interface Props {
  session: Session;
  repoOwner?: string;
  repoName?: string;
}

export function ViewerTopbar({ session, repoOwner, repoName }: Props) {
  const { resolved, toggle } = useTheme();
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
            <span className="brand-sep">/</span>
            <Link className="topbar-link" to={`/${repoOwner}`}>
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
          <button
            className="iconbtn"
            onClick={copyLink}
            type="button"
            aria-label="Copy share link"
          >
            <IconLink />
            <span>Share</span>
          </button>
          <button
            className="iconbtn"
            onClick={toggle}
            type="button"
            aria-label={
              resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"
            }
            title={resolved === "dark" ? "Light" : "Dark"}
          >
            {resolved === "dark" ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </div>
    </header>
  );
}
