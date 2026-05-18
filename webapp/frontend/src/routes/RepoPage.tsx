import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchRepoOverview } from "../api";
import type { RepoOverview } from "../types";
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

export function RepoPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const [data, setData] = useState<RepoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo) return;
    setError(null);
    setData(null);
    fetchRepoOverview(owner, repo)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [owner, repo]);

  if (!owner || !repo) return null;
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading…" />;

  const githubUrl = `https://github.com/${owner}/${repo}`;
  const repoInitial = repo.charAt(0).toLowerCase();

  return (
    <div className="page-shell">
      <PageTopbar
        crumbs={[
          { label: owner, to: `/${owner}` },
          { label: repo, to: `/${owner}/${repo}`, current: true },
        ]}
      />
      <main className="page">
        <section className="entity-head">
          <div className="entity-avatar">{repoInitial}</div>
          <div className="entity-body">
            <div className="entity-eyebrow">
              <span className="dot" />
              <span>REPOSITORY</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>indexed {relativeFrom(data.stats.last_trace_at)}</span>
            </div>
            <h1 className="entity-title">
              <Link to={`/${owner}`} className="owner">
                {owner}
              </Link>
              <span className="sep">/</span>
              <Link to={`/${owner}/${repo}`}>{repo}</Link>
            </h1>
            <div className="entity-meta">
              <a href={githubUrl} target="_blank" rel="noreferrer">
                github.com/{owner}/{repo} ↗
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
              {data.stats.pr_count} {data.stats.pr_count === 1 ? "PR" : "PRs"}
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
            <div className="stat-label">Contributors</div>
            <div className="stat-value">{data.stats.contributor_count}</div>
            <div className="stat-sub">
              {data.stats.last_trace_at
                ? `last upload ${relativeFrom(data.stats.last_trace_at)}`
                : "—"}
            </div>
          </div>
        </div>

        <div className="tabs">
          <button className="tab active" type="button">
            Traces <span className="count">{data.stats.trace_count}</span>
          </button>
          <button className="tab" type="button">
            Pull requests <span className="count">{data.stats.pr_count}</span>
          </button>
          <button className="tab" type="button">
            Contributors{" "}
            <span className="count">{data.stats.contributor_count}</span>
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
                  <TraceListRow key={t.short_id} trace={t} showUploader />
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
                <h4>Contributors</h4>
                <span className="ct">{data.stats.contributor_count}</span>
              </div>
              <div className="side-card-body">
                {data.contributors.length === 0 ? (
                  <div
                    className="empty"
                    style={{ padding: "16px 12px", fontSize: 13 }}
                  >
                    No contributors yet.
                  </div>
                ) : (
                  data.contributors.map((c) => (
                    <Link
                      key={c.login}
                      className="contrib-row"
                      to={`/${c.login}`}
                    >
                      <span
                        className="contrib-avatar"
                        style={{
                          background:
                            "linear-gradient(135deg, oklch(0.68 0.13 50), oklch(0.55 0.10 290))",
                        }}
                      >
                        {c.login.charAt(0).toUpperCase()}
                      </span>
                      <span className="contrib-name">{c.login}</span>
                      <span className="contrib-count">{c.trace_count}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="side-card">
              <div className="side-card-head">
                <h4>About</h4>
              </div>
              <div
                style={{
                  padding: "12px 14px 14px",
                  fontSize: 13,
                  color: "var(--text-muted)",
                  lineHeight: 1.55,
                }}
              >
                <p style={{ margin: "0 0 10px" }}>
                  Every trace on this repo is visible to anyone with the link.
                  Sensitive content is automatically redacted before indexing.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <footer className="footer">
        <span>
          repo · {owner}/{repo}
        </span>
        <span>vibeshub</span>
      </footer>
    </div>
  );
}
