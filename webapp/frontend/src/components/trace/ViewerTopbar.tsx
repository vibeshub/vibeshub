import type { Session } from "./types";
import { IconLink, IconMoon, IconSun } from "./icons";
import { useTheme } from "./theme";

interface Props {
  session: Session;
}

export function ViewerTopbar({ session }: Props) {
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
        <div className="brand">
          <span className="brand-mark">v</span>
          <span>vibeshub</span>
          <span className="brand-sep">/</span>
          <span className="brand-trace">trace/{id}</span>
        </div>
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
