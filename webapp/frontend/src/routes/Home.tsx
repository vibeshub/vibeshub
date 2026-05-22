import { useAuth } from "../auth/AuthContext";
import { Dashboard } from "./Dashboard";
import { Landing } from "./Landing";

/**
 * The "/" route. Signed-in visitors get their personal workspace dashboard;
 * everyone else gets the marketing landing page.
 *
 * While the session is still resolving we render an empty shell rather than
 * flashing the marketing page and then swapping it for the dashboard.
 */
export function Home() {
  const { loading, user } = useAuth();

  if (loading) {
    return <div className="page-shell" style={{ minHeight: "100vh" }} />;
  }

  return user ? <Dashboard user={user} /> : <Landing />;
}
