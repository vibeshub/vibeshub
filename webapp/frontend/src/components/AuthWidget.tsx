import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function AuthWidget() {
  const { loading, user } = useAuth();
  const location = useLocation();

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

  // Signed in: the widget is a straight link to the user's workspace.
  // Sign out lives on the workspace page itself.
  return (
    <Link className="iconbtn" to="/home" title="Go to your workspace">
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt=""
          width={20}
          height={20}
          style={{ borderRadius: "50%", marginRight: 6 }}
        />
      ) : null}
      <span>{`@${user.login}`}</span>
    </Link>
  );
}
