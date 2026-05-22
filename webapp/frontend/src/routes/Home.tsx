import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/**
 * The "/home" route. A signed-in visitor is sent to their own profile
 * page, which doubles as their workspace. Anonymous visitors have no
 * profile, so they go back to the shared landing page at "/".
 *
 * While the session is still resolving we render an empty shell rather
 * than redirecting prematurely and bouncing a signed-in user away.
 */
export function Home() {
  const { loading, user } = useAuth();

  if (loading) {
    return <div className="page-shell" style={{ minHeight: "100vh" }} />;
  }

  return user ? (
    <Navigate to={`/${user.login}`} replace />
  ) : (
    <Navigate to="/" replace />
  );
}
