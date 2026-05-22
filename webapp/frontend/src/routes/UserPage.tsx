import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchGithubUser, fetchUserOverview } from "../api";
import type { GithubUser, UserOverview, UserRepoEntry } from "../types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageTopbar } from "../components/PageTopbar";
import { TraceListRow } from "../components/TraceListRow";
import { useAuth } from "../auth/AuthContext";
import styles from "./UserPage.module.css";

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

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

type UserTab = "traces" | "repos";

export function UserPage() {
  const { owner } = useParams<{ owner: string }>();
  const [data, setData] = useState<UserOverview | null>(null);
  const [ghUser, setGhUser] = useState<GithubUser | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<UserTab>("traces");

  useEffect(() => {
    if (!owner) return;
    setError(null);
    setData(null);
    fetchUserOverview(owner)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [owner]);

  useEffect(() => {
    if (!owner) return;
    setGhError(null);
    setGhUser(null);
    fetchGithubUser(owner)
      .then(setGhUser)
      .catch((e) => setGhError(String(e)));
  }, [owner]);

  const { user } = useAuth();
  const isOwner =
    !!user && !!owner && user.login.toLowerCase() === owner.toLowerCase();
  const firstName = user
    ? (user.name?.trim().split(/\s+/)[0] || user.login).trim()
    : "";

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
        {isOwner && (
          <div className={styles.greetingLine}>
            {greetingFor(new Date())}, <strong>{firstName}</strong>.
          </div>
        )}
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
          {ghError || !ghUser ? (
            <div className="stat-cell">
              <div className="stat-label">GitHub</div>
              <div className="stat-value">—</div>
              <div className="stat-sub">
                {ghError ? "Stats unavailable" : "Loading…"}
              </div>
            </div>
          ) : (
            <>
              <div className="stat-cell">
                <div className="stat-label">Public repos</div>
                <div className="stat-value">
                  {compactCount(ghUser.public_repos)}
                </div>
                <div className="stat-sub">on github.com/{owner}</div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Stars</div>
                <div className="stat-value">
                  {compactCount(ghUser.total_public_stars)}
                </div>
                <div className="stat-sub">
                  {ghUser.stars_truncated
                    ? "from top 300 repos"
                    : "across public repos"}
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Followers</div>
                <div className="stat-value">
                  {compactCount(ghUser.followers)}
                </div>
                <div className="stat-sub">
                  following {compactCount(ghUser.following)}
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Top languages</div>
                <div className="stat-value" style={{ fontSize: 16 }}>
                  {ghUser.top_languages.length > 0
                    ? ghUser.top_languages.join(" · ")
                    : "—"}
                </div>
                <div className="stat-sub">
                  joined {ghUser.created_at?.slice(0, 4) ?? "—"}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="tabs">
          <button
            className={`tab${tab === "traces" ? " active" : ""}`}
            type="button"
            onClick={() => setTab("traces")}
          >
            Traces <span className="count">{data.stats.trace_count}</span>
          </button>
          <button
            className={`tab${tab === "repos" ? " active" : ""}`}
            type="button"
            onClick={() => setTab("repos")}
          >
            Repositories <span className="count">{data.stats.repo_count}</span>
          </button>
        </div>

        <div className="split">
          <div>
            {tab === "traces" && (
              <>
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
              </>
            )}

            {tab === "repos" && <RepoList repos={data.repos} />}
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

function RepoList({ repos }: { repos: UserRepoEntry[] }) {
  if (repos.length === 0) {
    return (
      <div className="trace-list">
        <div className="empty">No repositories yet.</div>
      </div>
    );
  }

  return (
    <>
      <div className="trace-list">
        {repos.map((r) => (
          <Link
            key={r.repo_full_name}
            className="trace-row"
            to={`/${r.repo_full_name}`}
          >
            <div
              className="trace-icon"
              style={{
                background: "var(--accent)",
                color: "white",
                fontWeight: 600,
              }}
            >
              {r.repo_name.charAt(0).toLowerCase()}
            </div>
            <div className="trace-body">
              <div className="trace-row-top">
                <span className="trace-title">{r.repo_full_name}</span>
              </div>
              <div className="trace-meta">
                <span>
                  {r.trace_count} {r.trace_count === 1 ? "trace" : "traces"}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="list-footer">
        <span>
          Showing {repos.length} {repos.length === 1 ? "repo" : "repos"}
        </span>
      </div>
    </>
  );
}
