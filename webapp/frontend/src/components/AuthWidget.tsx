import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function AuthWidget() {
  const { loading, user, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) return null;

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return (
      <a
        className="iconbtn primary"
        href={`/api/auth/github/login?next=${next}`}
      >
        Sign in with GitHub
      </a>
    );
  }

  return (
    <div className="auth-widget" style={{ position: "relative" }}>
      <button
        type="button"
        className="iconbtn"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            width={20}
            height={20}
            style={{ borderRadius: "50%", marginRight: 6 }}
          />
        ) : null}
        <span>{`@${user.login}`}</span> ▾
      </button>
      {menuOpen ? (
        <div
          role="menu"
          className="auth-menu"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            background: "var(--surface, white)",
            border: "1px solid var(--border, #ccc)",
            borderRadius: 6,
            padding: 4,
            minWidth: 140,
            zIndex: 10,
          }}
        >
          <button
            type="button"
            className="iconbtn"
            onClick={() => signOut()}
            style={{ width: "100%", textAlign: "left" }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
