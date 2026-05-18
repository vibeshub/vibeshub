import { Link } from "react-router-dom";
import { IconMoon, IconSun } from "./trace/icons";
import { useTheme } from "./trace/theme";

export interface Crumb {
  label: string;
  to?: string;
  current?: boolean;
}

interface Props {
  crumbs: Crumb[];
}

export function PageTopbar({ crumbs }: Props) {
  const { resolved, toggle } = useTheme();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" to="/">
          <span className="brand-mark">v</span>
          <span>vibeshub</span>
        </Link>
        {crumbs.map((c, i) => (
          <span key={`${i}-${c.label}`} style={{ display: "contents" }}>
            <span className="brand-sep">/</span>
            {c.to && !c.current ? (
              <Link className="topbar-link" to={c.to}>
                {c.label}
              </Link>
            ) : (
              <span
                className={`topbar-link${c.current ? " is-current" : ""}`}
              >
                {c.label}
              </span>
            )}
          </span>
        ))}
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <button
            className="iconbtn"
            onClick={toggle}
            type="button"
            aria-label={
              resolved === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
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
