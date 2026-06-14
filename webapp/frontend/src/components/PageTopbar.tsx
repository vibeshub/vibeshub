import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthWidget } from "./AuthWidget";
import { ThemeToggle } from "./ThemeToggle";

export interface Crumb {
  label: string;
  to?: string;
  current?: boolean;
}

interface Props {
  crumbs: Crumb[];
}

export function PageTopbar({ crumbs }: Props) {
  const { user } = useAuth();

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
          {user && (
            <Link className="topbar-link" to="/vibeviewer">
              Upload
            </Link>
          )}
          <ThemeToggle />
          <AuthWidget />
        </div>
      </div>
    </header>
  );
}
