import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchUserOverview } from "../api";
import type { UserOverview } from "../types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageTopbar } from "../components/PageTopbar";
import { TraceListRow } from "../components/TraceListRow";

function compactCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k.toFixed(k >= 10 ? 0 : 1)}k`;
  }
  return String(n);
}

function relativeFrom(iso: string | null): string {
  if (!iso) return "no uploads yet";
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function UserPage() {
  const { owner } = useParams<{ owner: string }>();
  const [data, setData] = useState<UserOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner) return;
    setError(null);
    setData(null);
    fetchUserOverview(owner)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [owner]);

  if (!owner) return null;
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading…" />;

  const initial = owner.charAt(0).toUpperCase();
  const githubUrl = `https://github.com/${owner}`;

  return (
    <div className="page-shell">
      <PageTopbar
        crumbs={[{ label: owner, to: `/${owner}`, current: true }]}
      />
      <main className="page">
        <section className="entity-head">
          <div className="entity-avatar user">{initial}</div>
          <div className="entity-body">
            <div className="entity-eyebrow">
              <span className="dot" />
              <span>USER</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>active {relativeFrom(data.stats.last_trace_at)}</span>
            </div>
            <h1 className="entity-title">
              <span className="at">@</span>
              {owner}
            </h1>
            <div className="entity-meta">
              <a href={githubUrl} target="_blank" rel="noreferrer">
                github.com/{owner} ↗
              </a>
            </div>
          </div>
          <div className="entity-actions">
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="iconbtn primary"
            >
              View on GitHub ↗
            </a>
          </div>
        </section>

        <div className="stat-strip">
          <div className="stat-cell">
            <div className="stat-label">Traces</div>
            <div className="stat-value">{data.stats.trace_count}</div>
            <div className="stat-sub">
              across {data.stats.repo_count}{" "}
              {data.stats.repo_count === 1 ? "repo" : "repos"}
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Messages</div>
            <div className="stat-value">
              {compactCount(data.stats.message_count)}
            </div>
            <div className="stat-sub">
              {data.stats.trace_count > 0
                ? `avg ${Math.round(
                    data.stats.message_count / data.stats.trace_count,
                  )} / trace`
                : "—"}
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Size</div>
            <div className="stat-value">
              {compactCount(Math.round(data.stats.byte_size / 1024))} KB
            </div>
            <div className="stat-sub">total trace data</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Last upload</div>
            <div className="stat-value">
              {data.stats.last_trace_at
                ? relativeFrom(data.stats.last_trace_at)
                : "—"}
            </div>
            <div className="stat-sub">
              {data.stats.last_trace_at
                ? new Date(data.stats.last_trace_at).toLocaleDateString()
                : "no uploads yet"}
            </div>
          </div>
        </div>

        <div className="tabs">
          <button className="tab active" type="button">
            Traces <span className="count">{data.stats.trace_count}</span>
          </button>
          <button className="tab" type="button">
            Repositories <span className="count">{data.stats.repo_count}</span>
          </button>
        </div>

        <div className="split">
          <div>
            {data.traces.length === 0 ? (
              <div className="trace-list">
                <div className="empty">No traces yet.</div>
              </div>
            ) : (
              <div className="trace-list">
                {data.traces.map((t) => (
                  <TraceListRow key={t.short_id} trace={t} showRepoChip />
                ))}
              </div>
            )}

            <div className="list-footer">
              <span>
                Showing {data.traces.length} of {data.stats.trace_count} traces
              </span>
            </div>
          </div>

          <aside>
            <div className="side-card">
              <div className="side-card-head">
                <h4>Top repositories</h4>
                <span className="ct">{data.stats.repo_count}</span>
              </div>
              <div className="side-card-body">
                {data.repos.length === 0 ? (
                  <div
                    className="empty"
                    style={{ padding: "16px 12px", fontSize: 13 }}
                  >
                    No repositories yet.
                  </div>
                ) : (
                  data.repos.map((r) => (
                    <Link
                      key={r.repo_full_name}
                      className="contrib-row"
                      to={`/${r.repo_full_name}`}
                    >
                      <span
                        className="contrib-avatar square"
                        style={{ background: "var(--accent)" }}
                      >
                        {r.repo_name.charAt(0).toLowerCase()}
                      </span>
                      <span className="contrib-name">{r.repo_name}</span>
                      <span className="contrib-count">{r.trace_count}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>

      <footer className="footer">
        <span>user · @{owner}</span>
        <span>vibeshub</span>
      </footer>
    </div>
  );
}
