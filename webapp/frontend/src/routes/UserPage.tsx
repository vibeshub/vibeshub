import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchGithubContributions,
  fetchGithubUser,
  fetchUserOverview,
} from "../api";
import type {
  GithubContributionDay,
  GithubContributions,
  GithubUser,
  UserOverview,
  UserRepoEntry,
} from "../types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageTopbar } from "../components/PageTopbar";
import { SeoHead } from "../components/SeoHead";
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

/* ------------------------------------------------------------------ *
 * activity heatmap — a 53-week grid built from GitHub's contribution
 * calendar (the green-squares graph). Counts and intensity come from
 * github.com, not from vibeshub traces.
 * ------------------------------------------------------------------ */

const WEEKS = 53;
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

interface HeatCell {
  date: Date;
  count: number;
  /** -1 future (not yet rendered), 0 empty, 1-4 intensity */
  level: number;
}

interface HeatModel {
  weeks: HeatCell[][];
  monthLabels: (string | null)[];
  total: number;
  thisWeek: number;
  longestStreak: number;
  busiestWeekday: string | null;
}

/** Local calendar date as YYYY-MM-DD — matches GitHub's day keys. */
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function buildHeatmap(days: GithubContributionDay[]): HeatModel {
  const byDate = new Map<string, GithubContributionDay>();
  for (const d of days) byDate.set(d.date, d);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Walk back to the Sunday that starts the window.
  const start = new Date(today);
  start.setDate(start.getDate() - today.getDay() - (WEEKS - 1) * 7);

  const weeks: HeatCell[][] = [];
  const monthLabels: (string | null)[] = [];
  const weekdayTotals = new Array(7).fill(0);
  const cursor = new Date(start);
  let prevMonth = -1;

  for (let w = 0; w < WEEKS; w++) {
    const week: HeatCell[] = [];
    const firstMonth = cursor.getMonth();
    monthLabels.push(firstMonth !== prevMonth ? MONTHS[firstMonth] : null);
    prevMonth = firstMonth;

    for (let d = 0; d < 7; d++) {
      const isFuture = cursor.getTime() > today.getTime();
      const rec = isFuture ? undefined : byDate.get(isoDay(cursor));
      const count = rec?.count ?? 0;
      if (!isFuture) weekdayTotals[cursor.getDay()] += count;
      week.push({
        date: new Date(cursor),
        count,
        level: isFuture ? -1 : rec?.level ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  // Derived figures, computed over the rendered (non-future) window.
  const flat = weeks.flat().filter((c) => c.level >= 0);
  const total = flat.reduce((s, c) => s + c.count, 0);

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const thisWeek = flat
    .filter((c) => c.date.getTime() >= weekAgo.getTime())
    .reduce((s, c) => s + c.count, 0);

  let longestStreak = 0;
  let run = 0;
  for (const c of flat) {
    if (c.count > 0) {
      run += 1;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 0;
    }
  }

  let busiestWeekday: string | null = null;
  const maxWd = Math.max(...weekdayTotals);
  if (maxWd > 0) {
    busiestWeekday = WEEKDAY_NAMES[weekdayTotals.indexOf(maxWd)];
  }

  return { weeks, monthLabels, total, thisWeek, longestStreak, busiestWeekday };
}

/* ------------------------------------------------------------------ *
 * install snippet — single source of truth for the onboarding card
 * ------------------------------------------------------------------ */

const INSTALL_COPY = [
  "/plugin marketplace add vibeshub/vibeshub",
  "/plugin install vibeshub@vibeshub",
].join("\n");

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

  const traceCount = data.stats.trace_count;
  const userDescription =
    `@${owner} on vibeshub — ` +
    (traceCount > 0
      ? `${traceCount} public Claude Code session${traceCount === 1 ? "" : "s"}.`
      : "Public Claude Code sessions and contributions.");

  return (
    <div className="page-shell">
      <SeoHead
        title={`@${owner}`}
        description={userDescription}
        path={`/${owner}`}
        ogType="profile"
      />
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
            {isOwner && <CopyLinkButton login={owner} />}
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
              last upload {relativeFrom(data.stats.last_trace_at)}
            </div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Repositories</div>
            <div className="stat-value">{data.stats.repo_count}</div>
            <div className="stat-sub">with captured sessions</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Messages</div>
            <div className="stat-value">
              {compactCount(data.stats.message_count)}
            </div>
            <div className="stat-sub">across every session</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Followers</div>
            <div className="stat-value">
              {ghError || !ghUser ? "—" : compactCount(ghUser.followers)}
            </div>
            <div className="stat-sub">
              {ghError
                ? "GitHub stats unavailable"
                : !ghUser
                  ? "loading…"
                  : `following ${compactCount(ghUser.following)}`}
            </div>
          </div>
        </div>

        <div style={{ margin: "24px 0" }}>
          <GithubActivity login={owner} />
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
                  isOwner ? (
                    <Onboarding />
                  ) : (
                    <div className="trace-list">
                      <div className="empty">No traces yet.</div>
                    </div>
                  )
                ) : (
                  <>
                    <div className="trace-list">
                      {data.traces.map((t) => (
                        <TraceListRow
                          key={t.short_id}
                          trace={t}
                          showRepoChip
                        />
                      ))}
                    </div>
                    <div className="list-footer">
                      <span>
                        Showing {data.traces.length} of{" "}
                        {data.stats.trace_count} traces
                      </span>
                    </div>
                  </>
                )}
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

            {isOwner && (
              <>
                <div className={styles.card} style={{ marginTop: 18 }}>
                  <div className={styles.cardHead}>
                    <h4>Capturing more</h4>
                  </div>
                  <div className={styles.tip}>
                    <p className={styles.tipText}>
                      Every time Claude Code runs <code>gh pr create</code>,
                      the plugin attaches a fresh trace automatically.
                    </p>
                    <div className={styles.term}>
                      <span className={styles.prompt}>$ </span>
                      <span className={styles.cmd}>gh pr create</span> --fill
                      {"\n"}
                      <span className={styles.echo}>
                        ↳ vibeshub: redacted · uploaded ✓
                      </span>
                    </div>
                  </div>
                </div>

                {user && !user.has_private_access && (
                  <div className={styles.card}>
                    <div className={styles.privCard}>
                      <h4>Working in private repos?</h4>
                      <p>
                        Grant private access so traces from private
                        repositories open for teammates with repo access.
                      </p>
                      <a
                        className={styles.privLink}
                        href="/api/auth/github/login?scope=private&next=%2Fhome"
                      >
                        <IconShield />
                        Enable private repositories
                      </a>
                    </div>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      </main>

      <footer className="footer">
        <span>user · @{owner}</span>
        <span>
          <Link to="/contact">Contact</Link> · vibeshub
        </span>
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

function CopyLinkButton({ login }: { login: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const url = `${window.location.origin}/${login}`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <button type="button" className="iconbtn" onClick={copy}>
      {copied ? "Link copied" : "Copy profile link"}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * onboarding (zero-trace state)
 * ------------------------------------------------------------------ */

function Onboarding() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(INSTALL_COPY).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  };

  return (
    <section className={`${styles.rise} ${styles.onboard}`}>
      <div className={styles.onboardLeft}>
        <span className={styles.onboardKicker}>No traces yet</span>
        <h2>Capture your first Claude Code session.</h2>
        <p>
          Install the plugin once. After that, every PR Claude Code opens with{" "}
          <code>gh pr create</code> auto-attaches a redacted, replayable
          trace — and it shows up right here.
        </p>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <span className={styles.stepText}>
              <strong>Add the marketplace</strong> with one slash command.
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum}>2</span>
            <span className={styles.stepText}>
              <strong>Install the plugin</strong> inside Claude Code.
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum}>3</span>
            <span className={styles.stepText}>
              <strong>Open a PR</strong> — the trace lands here on its own.
            </span>
          </li>
        </ol>
      </div>

      <div className={styles.onboardRight}>
        <div className={styles.codeHead}>
          <span className={styles.codeDots}>
            <span />
            <span />
            <span />
          </span>
          <span className={styles.codeTitle}>install · shell</span>
          <button
            type="button"
            className={`${styles.codeCopy} ${copied ? styles.copied : ""}`}
            onClick={copy}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
        <pre className={styles.code}>
          <span className={styles.cmt}>
            # 1 · add the marketplace in Claude Code
          </span>
          {"\n"}
          /plugin marketplace add{" "}
          <span className={styles.arg}>vibeshub/vibeshub</span>
          {"\n\n"}
          <span className={styles.cmt}># 2 · install the plugin</span>
          {"\n"}
          /plugin install <span className={styles.arg}>vibeshub@vibeshub</span>
          {"\n\n"}
          <span className={styles.cmt}># 3 · next PR auto-attaches a trace</span>
          {"\n"}
          <span className={styles.prompt}>$ </span>gh pr create --fill{"\n"}
          <span className={styles.ok}>
            {"  ↳ vibeshub: redacted · uploaded · commented ✓"}
          </span>
        </pre>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * GitHub activity — the contribution heatmap
 * ------------------------------------------------------------------ */

/**
 * Self-contained contribution heatmap: fetches GitHub's contribution
 * calendar for `login` and renders the heatmap card. Shown on every
 * profile — this is public GitHub data. While the fetch is in flight it
 * shows a loading placeholder; on error it renders nothing.
 */
function GithubActivity({ login }: { login: string }) {
  const [contrib, setContrib] = useState<GithubContributions | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setContrib(null);
    fetchGithubContributions(login)
      .then(setContrib)
      .catch(() => setFailed(true));
  }, [login]);

  if (failed) return null;
  if (!contrib) return <ActivityLoading />;
  return <GithubActivitySection login={login} contrib={contrib} />;
}

function GithubActivitySection({
  login,
  contrib,
}: {
  login: string;
  contrib: GithubContributions;
}) {
  const heat = useMemo(() => buildHeatmap(contrib.days), [contrib.days]);

  return (
    <section className={styles.rise}>
      <div className={styles.blockHead}>
        <div className={styles.blockTitle}>
          GitHub activity
          <span className={styles.ct}>last 12 months</span>
        </div>
        <a
          className={styles.blockLink}
          href={`https://github.com/${login}`}
          target="_blank"
          rel="noreferrer"
        >
          github.com/{login}
          <IconArrow />
        </a>
      </div>

      <div className={styles.activity}>
        <div className={styles.activityHead}>
          <IconGithub />
          <span className={styles.label}>public contributions</span>
          <span className={styles.spacer} />
          <span className={styles.total}>
            {heat.total} {heat.total === 1 ? "contribution" : "contributions"}
          </span>
        </div>

        <div className={styles.activityGrid}>
          <div className={styles.heatWrap}>
            <div className={styles.months}>
              {heat.monthLabels.map((m, i) => (
                <span key={i} className={styles.month}>
                  {m ?? ""}
                </span>
              ))}
            </div>
            <div className={styles.heatBody}>
              <div className={styles.weekdays}>
                {WEEKDAY_LABELS.map((d, i) => (
                  <span key={i} className={styles.weekday}>
                    {d}
                  </span>
                ))}
              </div>
              <div className={styles.weeks}>
                {heat.weeks.map((week, wi) => (
                  <div key={wi} className={styles.week}>
                    {week.map((cell, di) => (
                      <span
                        key={di}
                        className={`${styles.cell} ${styles.lvl}`}
                        data-level={cell.level}
                        title={
                          cell.level < 0
                            ? undefined
                            : `${cell.count} ${
                                cell.count === 1
                                  ? "contribution"
                                  : "contributions"
                              } · ${cell.date.toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}`
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.legend}>
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((l) => (
                <span
                  key={l}
                  className={`${styles.sq} ${styles.lvl}`}
                  data-level={l}
                />
              ))}
              <span>More</span>
            </div>
          </div>

          <div className={styles.activityStats}>
            <Figure
              label="This week"
              value={String(heat.thisWeek)}
              unit={heat.thisWeek === 1 ? "contribution" : "contributions"}
              sub="in the last 7 days"
            />
            <Figure
              label="Longest streak"
              value={String(heat.longestStreak)}
              unit={heat.longestStreak === 1 ? "day" : "days"}
              sub="consecutive active days"
            />
            <Figure
              label="Busiest day"
              value={heat.busiestWeekday ?? "—"}
              sub={
                heat.busiestWeekday
                  ? "most contributions land here"
                  : "no activity in window"
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ActivityLoading() {
  return (
    <section className={styles.rise}>
      <div className={styles.blockHead}>
        <div className={styles.blockTitle}>
          GitHub activity
          <span className={styles.ct}>last 12 months</span>
        </div>
      </div>
      <div className={styles.activity}>
        <div className={styles.loading}>
          <span className={styles.blink} />
          loading contribution graph…
        </div>
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
}) {
  return (
    <div className={styles.figure}>
      <div className={styles.figureLabel}>{label}</div>
      <div className={styles.figureValue}>
        {value}
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
      <div className={styles.figureSub}>{sub}</div>
    </div>
  );
}

/* ------------------------------- icons ------------------------------- */

function IconArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function IconGithub() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.81 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
