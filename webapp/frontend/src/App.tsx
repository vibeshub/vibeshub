import { Route, Routes } from "react-router-dom";
import { Landing } from "./routes/Landing";
import { NotFound } from "./routes/NotFound";
import { PrTracesList } from "./routes/PrTracesList";
import { TraceView } from "./routes/TraceView";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path=":owner/:repo/pull/:number"
        element={<PrTracesList />}
      />
      <Route
        path=":owner/:repo/pull/:number/:shortId"
        element={<TraceView />}
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
