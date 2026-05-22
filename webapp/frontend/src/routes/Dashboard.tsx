import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchGithubContributions, fetchUserOverview } from "../api";
import type {
  GithubContributionDay,
  GithubContributions,
  MeResponse,
  UserOverview,
} from "../types";
import { PageTopbar } from "../components/PageTopbar";
import { TraceListRow } from "../components/TraceListRow";
import styles from "./Dashboard.module.css";

/* ------------------------------------------------------------------ *
 * formatting helpers
 * ------------------------------------------------------------------ */

function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) {
    const k = n / 1000;
    return `${k.toFixed(k >= 10 ? 0 : 1)}k`;
  }
  return String(n);
}

function formatBytes(n: number): { value: string; unit: string } {
  if (n >= 1_000_000) return { value: (n / 1_000_000).toFixed(1), unit: "MB" };
  if (n >= 1000) return { value: String(Math.round(n / 1000)), unit: "KB" };
  return { value: String(n), unit: "B" };
}

function relativeFrom(iso: string | null): string {
  if (!iso) return "no uploads yet";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.round(diff / 60_000);
  if (m < 1) return "moments ago";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.round(d / 30);
  return `${mo} mo ago`;
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
  "git clone https://github.com/Bhavya6187/vibeshub.git",
  "/plugin marketplace add ./vibeshub",
  "/plugin install vibeshub@vibeshub",
].join("\n");

/* ================================================================== *
 * Dashboard
 * ================================================================== */

export function Dashboard({ user }: { user: MeResponse }) {
  const [overview, setOverview] = useState<UserOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [contrib, setContrib] = useState<GithubContributions | null>(null);
  const [contribError, setContribError] = useState<string | null>(null);

  useEffect(() => {
    setOverviewError(null);
    setOverview(null);
    fetchUserOverview(user.login)
      .then(setOverview)
      .catch((e) => setOverviewError(String(e)));
  }, [user.login]);

  useEffect(() => {
    setContribError(null);
    setContrib(null);
    fetchGithubContributions(user.login)
      .then(setContrib)
      .catch((e) => setContribError(String(e)));
  }, [user.login]);

  const firstName = (user.name?.trim().split(/\s+/)[0] || user.login).trim();
  const greeting = greetingFor(new Date());
  const profilePath = `/${user.login}`;
  const hasTraces = !!overview && overview.stats.trace_count > 0;

  return (
    <div className={`page-shell ${styles.shell}`}>
      <PageTopbar crumbs={[]} />

      <main>
        {/* ---------------------------- hero ---------------------------- */}
        <section className={styles.hero}>
          <div className={`${styles.wrap} ${styles.heroRow}`}>
            <div className={styles.heroLeft}>
              <span className={styles.eyebrow}>
                <span className={styles.pulse} />
                Your workspace
              </span>
              <h1 className={styles.greeting}>
                {greeting},{" "}
                <span className={styles.name}>{firstName}</span>.
              </h1>
              <p className={styles.lede}>
                {hasTraces ? (
                  <>
                    <strong>{overview!.stats.trace_count}</strong>{" "}
                    {overview!.stats.trace_count === 1 ? "trace" : "traces"}{" "}
                    live across <strong>{overview!.stats.repo_count}</strong>{" "}
                    {overview!.stats.repo_count === 1
                      ? "repository"
                      : "repositories"}{" "}
                    — every Claude Code session behind your pull requests,
                    captured and replayable.
                  </>
                ) : (
                  <>
                    This is where every Claude Code session behind your pull
                    requests lands — captured, redacted, and replayable, the
                    moment Claude Code opens a PR.
                  </>
                )}
              </p>
              <div className={styles.heroActions}>
                <Link
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  to={profilePath}
                >
                  View public profile
                  <IconArrow />
                </Link>
                <CopyLinkButton login={user.login} />
                <a
                  className={`${styles.btn} ${styles.btnGhost}`}
                  href={`https://github.com/${user.login}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconGithub />
                  GitHub
                </a>
              </div>
            </div>

            <div className={styles.idCard}>
              <Avatar user={user} />
              <div className={styles.idName}>{user.name ?? user.login}</div>
              <div className={styles.idHandle}>@{user.login}</div>
              {user.has_private_access ? (
                <span className={`${styles.idStatus} ${styles.priv}`}>
                  <IconShield />
                  Private access on
                </span>
              ) : (
                <span className={styles.idStatus}>
                  <IconGithub />
                  Public traces
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ---------------------------- body ---------------------------- */}
        <div className={`${styles.wrap} ${styles.body}`}>
          {/* GitHub activity — sourced from github.com, independent of
              whether vibeshub has captured any traces yet. */}
          {contrib ? (
            <GithubActivitySection login={user.login} contrib={contrib} />
          ) : contribError ? null : (
            <ActivityLoading />
          )}

          {/* vibeshub's own data — traces, repos, stats. */}
          {overviewError && (
            <div className={styles.inlineError}>
              <strong>Couldn't load your traces.</strong> {overviewError}
            </div>
          )}

          {!overview && !overviewError && (
            <div className={styles.loading}>
              <span className={styles.blink} />
              loading your traces…
            </div>
          )}

          {overview && overview.stats.trace_count === 0 && <Onboarding />}

          {overview && overview.stats.trace_count > 0 && (
            <TraceSummary overview={overview} user={user} />
          )}
        </div>

        <footer className={styles.foot}>
          <div className={`${styles.wrap} ${styles.footInner}`}>
            <span>signed in as @{user.login}</span>
            <a href="https://github.com/Bhavya6187/vibeshub">
              vibeshub · github
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * GitHub activity — the contribution heatmap
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * trace summary — vibeshub's own data: stat strip + recent + aside
 * ------------------------------------------------------------------ */

function TraceSummary({
  overview,
  user,
}: {
  overview: UserOverview;
  user: MeResponse;
}) {
  const bytes = formatBytes(overview.stats.byte_size);
  const recent = overview.traces.slice(0, 6);
  const topRepos = overview.repos.slice(0, 6);

  return (
    <>
      {/* stat strip — reuses the shared .stat-strip primitive */}
      <section className={`${styles.rise} stat-strip`}>
        <div className="stat-cell">
          <div className="stat-label">Traces</div>
          <div className="stat-value">{overview.stats.trace_count}</div>
          <div className="stat-sub">
            last upload {relativeFrom(overview.stats.last_trace_at)}
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Repositories</div>
          <div className="stat-value">{overview.stats.repo_count}</div>
          <div className="stat-sub">with captured sessions</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Messages</div>
          <div className="stat-value">
            {compactCount(overview.stats.message_count)}
          </div>
          <div className="stat-sub">across every session</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Transcript size</div>
          <div className="stat-value">
            {bytes.value}
            <span
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                marginLeft: 3,
              }}
            >
              {bytes.unit}
            </span>
          </div>
          <div className="stat-sub">uploaded in total</div>
        </div>
      </section>

      {/* recent traces + aside */}
      <section className={`${styles.rise} ${styles.split}`}>
        <div>
          <div className={styles.blockHead}>
            <div className={styles.blockTitle}>
              Recent traces
              <span className={styles.ct}>
                {recent.length} of {overview.stats.trace_count}
              </span>
            </div>
            <Link className={styles.blockLink} to={`/${user.login}`}>
              View all
              <IconArrow />
            </Link>
          </div>
          <div className="trace-list">
            {recent.map((t) => (
              <TraceListRow key={t.short_id} trace={t} showRepoChip />
            ))}
          </div>
        </div>

        <aside>
          {/* top repositories */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h4>Your repositories</h4>
              <span className={styles.ct}>{overview.stats.repo_count}</span>
            </div>
            <div className={styles.cardBody}>
              {topRepos.length === 0 ? (
                <div className={styles.cardEmpty}>No repositories yet.</div>
              ) : (
                topRepos.map((r) => (
                  <Link
                    key={r.repo_full_name}
                    className={styles.repoRow}
                    to={`/${r.repo_full_name}`}
                  >
                    <span className={styles.repoMark}>
                      {r.repo_name.charAt(0).toLowerCase()}
                    </span>
                    <span className={styles.repoName}>{r.repo_name}</span>
                    <span className={styles.repoCount}>{r.trace_count}</span>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* capture tip */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h4>Capturing more</h4>
            </div>
            <div className={styles.tip}>
              <p className={styles.tipText}>
                Every time Claude Code runs <code>gh pr create</code>, the
                plugin attaches a fresh trace automatically.
              </p>
              <div className={styles.term}>
                <span className={styles.prompt}>$ </span>
                <span className={styles.cmd}>gh pr create</span> --fill{"\n"}
                <span className={styles.echo}>
                  ↳ vibeshub: redacted · uploaded ✓
                </span>
              </div>
            </div>
          </div>

          {/* private-repo nudge */}
          {!user.has_private_access && (
            <div className={styles.card}>
              <div className={styles.privCard}>
                <h4>Working in private repos?</h4>
                <p>
                  Grant private access so traces from private repositories
                  open for teammates with repo access.
                </p>
                <a
                  className={styles.privLink}
                  href="/api/auth/github/login?scope=private&next=%2F"
                >
                  <IconShield />
                  Enable private repositories
                </a>
              </div>
            </div>
          )}
        </aside>
      </section>
    </>
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
              <strong>Clone &amp; register</strong> the vibeshub marketplace.
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
          <span className={styles.cmt}># 1 · clone the repo</span>
          {"\n"}
          <span className={styles.prompt}>$ </span>git clone{" "}
          <span className={styles.arg}>
            https://github.com/Bhavya6187/vibeshub.git
          </span>
          {"\n\n"}
          <span className={styles.cmt}>
            # 2 · register + install in Claude Code
          </span>
          {"\n"}
          /plugin marketplace add <span className={styles.arg}>./vibeshub</span>
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
 * small pieces
 * ------------------------------------------------------------------ */

function Avatar({ user }: { user: MeResponse }) {
  if (user.avatar_url) {
    return (
      <img
        className={styles.avatar}
        src={user.avatar_url}
        alt=""
        width={64}
        height={64}
      />
    );
  }
  return (
    <span className={styles.avatar}>
      {(user.login.charAt(0) || "?").toUpperCase()}
    </span>
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
    <button
      type="button"
      className={`${styles.btn} ${styles.btnGhost} ${
        copied ? styles.ok : ""
      }`}
      onClick={copy}
    >
      {copied ? <IconCheck /> : <IconLink />}
      {copied ? "Link copied" : "Copy profile link"}
    </button>
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

function IconLink() {
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
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12 5 5 9-11" />
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
