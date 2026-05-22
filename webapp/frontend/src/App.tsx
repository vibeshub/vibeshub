import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { Home } from "./routes/Home";
import { Landing } from "./routes/Landing";
import { NotFound } from "./routes/NotFound";
import { PrTracesList } from "./routes/PrTracesList";
import { RepoPage } from "./routes/RepoPage";
import { TraceView } from "./routes/TraceView";
import { UserPage } from "./routes/UserPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/home" element={<Home />} />
        <Route path="t/:shortId" element={<TraceView />} />
        <Route
          path=":owner/:repo/pull/:number"
          element={<PrTracesList />}
        />
        <Route
          path=":owner/:repo/pull/:number/:shortId"
          element={<TraceView />}
        />
        <Route path=":owner/:repo" element={<RepoPage />} />
        <Route path=":owner" element={<UserPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
