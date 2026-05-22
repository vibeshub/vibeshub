import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Dashboard } from "./Dashboard";

/**
 * The "/home" route — a signed-in visitor's personal workspace dashboard.
 * Anonymous visitors have no workspace, so they're sent back to the shared
 * landing page at "/".
 *
 * While the session is still resolving we render an empty shell rather than
 * redirecting prematurely and bouncing a signed-in user away.
 */
export function Home() {
  const { loading, user } = useAuth();

  if (loading) {
    return <div className="page-shell" style={{ minHeight: "100vh" }} />;
  }

  return user ? <Dashboard user={user} /> : <Navigate to="/" replace />;
}
