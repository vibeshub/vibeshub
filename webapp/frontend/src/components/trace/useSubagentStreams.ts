import { useEffect, useState } from "react";
import type { TraceSummary } from "../../types";
import type { SubagentEntry } from "./changes";
import { buildSessionFromRaw } from "./sessionFromRaw";
import { fetchAgentJsonl } from "../../api";

// Fetch and parse every subagent's stream once per trace, paired with its
// AgentSummary so consumers can attribute events to the spawning Task call.
// Guardian subagents are review threads and are excluded. Failures are
// swallowed per-agent so one broken subagent doesn't blank the consumers.
export function useSubagentStreams(trace: TraceSummary): {
  entries: SubagentEntry[];
  loading: boolean;
} {
  const [entries, setEntries] = useState<SubagentEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(
    (trace.agents?.length ?? 0) > 0,
  );

  useEffect(() => {
    const agents = (trace.agents ?? []).filter(
      (a) => a.agent_type !== "guardian",
    );
    if (agents.length === 0) {
      setEntries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      agents.map((a) =>
        fetchAgentJsonl(trace.short_id, a.agent_id)
          .then(
            (jsonl): SubagentEntry => ({
              agent: a,
              stream: buildSessionFromRaw(jsonl).stream,
            }),
          )
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      setEntries(results.filter((r): r is SubagentEntry => r !== null));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [trace.short_id, trace.agents]);

  return { entries, loading };
}
