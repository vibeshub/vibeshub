import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthWidget } from "../components/AuthWidget";
import { IconMoon, IconSun } from "../components/trace/icons";
import { useTheme } from "../components/trace/theme";
import { fetchRepoOverview } from "../api";
import type { RepoOverview, TraceSummary } from "../types";
import styles from "./Landing.module.css";

// Keep in sync with plugins/claude-code/.claude-plugin/plugin.json.
const PLUGIN_VERSION = "0.3.0";
const VERSION_LABEL = `v${PLUGIN_VERSION.split(".").slice(0, 2).join(".")}`;

// What a new user needs on their machine before installing.
const INSTALL_PREREQS = "Claude Code · gh CLI (run 'gh auth login') · python3 3.9+";

// The runnable install commands - single source of truth for both copy buttons.
const INSTALL_STEPS = [
  "git clone https://github.com/Bhavya6187/vibeshub.git",
  "/plugin marketplace add ./vibeshub",
  "/plugin install vibeshub@vibeshub",
];
const INSTALL_COPY = INSTALL_STEPS.join("\n");

// The vibeshub repo that powers the Browse section.
const BROWSE_OWNER = "Bhavya6187";
const BROWSE_REPO = "vibeshub";
const BROWSE_FULL = `${BROWSE_OWNER}/${BROWSE_REPO}`;
const BROWSE_MAX = 6;

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
      },
      () => {},
    );
  };
  return { copied, copy };
}

function compactCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${k.toFixed(k >= 10 ? 0 : 1)}k`;
  }
  return String(n);
}

function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

export function Landing() {
  const { resolved, toggle } = useTheme();
  const { copied, copy } = useCopy();
  const [browse, setBrowse] = useState<RepoOverview | null>(null);
  // Which hero tile is expanded. null = all collapsed; single-open accordion.
  const [openWay, setOpenWay] = useState<number | null>(null);
  const toggleWay = (i: number) => setOpenWay((cur) => (cur === i ? null : i));

  // Pull the real public traces for the vibeshub repo to fill the Browse
  // section. Errors are swallowed - the section degrades to skeletons.
  useEffect(() => {
    let alive = true;
    fetchRepoOverview(BROWSE_OWNER, BROWSE_REPO)
      .then((data) => {
        if (alive) setBrowse(data);
      })
      .catch(() => {
        /* keep skeleton */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={`page-shell ${styles.shell}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <span className="brand-mark">v</span>
            <span>vibeshub</span>
          </Link>
          <span className="brand-sep">/</span>
          <span className={styles.tagline}>git for your vibes</span>

          <div className="topbar-spacer" />

          <nav className={`${styles.navLinks} ${styles.hideSm}`}>
            <a href="#browse">Browse</a>
            <a href="#privacy">Privacy</a>
            <a href="#install">Install</a>
          </nav>

          <div className="topbar-actions">
            <AuthWidget />
            <button
              className="iconbtn"
              onClick={toggle}
              type="button"
              aria-label={
                resolved === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              title={resolved === "dark" ? "Light" : "Dark"}
            >
              {resolved === "dark" ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* ====================== hero ====================== */}
        <section className={styles.hero}>
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroLeft}>
              <div className={styles.heroEyebrow}>
                <span className={styles.tag}>{VERSION_LABEL}</span>
                <span>public &amp; private &middot; for Claude Code</span>
              </div>
              <h1 className={styles.heroH1}>
                Don&rsquo;t just ship the diff -
                <br />
                share the <span className={styles.hl}>vibe</span>.
              </h1>
              <p className={styles.heroSub}>
                Vibeshub captures any Claude Code session and turns it into a
                shareable, replayable trace. Show teammates how you actually
                shipped it, or revisit your own reasoning weeks later.
              </p>
              <div className={styles.heroActions}>
                <a
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  href="#install"
                >
                  Install now
                  <ArrowRight />
                </a>
              </div>
            </div>

            {/* right: pick the workflow that fits - compact 3-tile preview */}
            <div className={styles.heroVisual}>
              <div className={styles.eyebrow}>
                <span className={styles.dot} /> Pick the workflow that fits
              </div>
              <ul className={styles.heroWays}>
                <li className={openWay === 0 ? styles.heroWayItemOpen : undefined}>
                  <button
                    type="button"
                    className={styles.heroWay}
                    onClick={() => toggleWay(0)}
                    aria-expanded={openWay === 0}
                  >
                    <span className={styles.heroWayMark}>
                      <IconPrSvg />
                    </span>
                    <div className={styles.heroWayHeading}>
                      <span className={styles.heroWayNum}>01 · Automatic</span>
                      <span className={styles.heroWayTitle}>
                        Posts on every PR you open or update
                      </span>
                    </div>
                    <span className={styles.heroWayChev} aria-hidden="true">
                      <IconChevronDown />
                    </span>
                  </button>
                  {openWay === 0 && (
                    <div className={styles.heroWayPanel}>
                      <p className={styles.heroWayDesc}>
                        Open or update a PR from your Claude Code session and
                        the trace lands on the PR as a comment
                        automatically. Reviewers see how you actually built it
                        before they read the diff. You change nothing about
                        how you work.
                      </p>
                      <div className={styles.mini}>
                        <div className={styles.miniHead}>
                          claude-code &middot; in your session
                        </div>
                        <pre className={styles.miniBody}>
                          <span className={styles.miniCmd}>
                            &gt; open a PR for the navbar fix
                          </span>
                          {"\n"}
                          <span className={styles.miniPriv}>
                            {"  → PR opened: acme/site#482"}
                          </span>
                          {"\n"}
                          <span className={styles.miniOk}>
                            {"  → vibeshub: uploaded · commented on PR ✓"}
                          </span>
                        </pre>
                      </div>
                    </div>
                  )}
                </li>
                <li className={openWay === 1 ? styles.heroWayItemOpen : undefined}>
                  <button
                    type="button"
                    className={styles.heroWay}
                    onClick={() => toggleWay(1)}
                    aria-expanded={openWay === 1}
                  >
                    <span className={styles.heroWayMark}>
                      <IconTerminal />
                    </span>
                    <div className={styles.heroWayHeading}>
                      <span className={styles.heroWayNum}>02 · Slash command</span>
                      <span className={styles.heroWayTitle}>
                        Share with <code>/share-trace</code>
                      </span>
                    </div>
                    <span className={styles.heroWayChev} aria-hidden="true">
                      <IconChevronDown />
                    </span>
                  </button>
                  {openWay === 1 && (
                    <div className={styles.heroWayPanel}>
                      <p className={styles.heroWayDesc}>
                        Share a single session on demand , a clever
                        debug, a tough refactor, a moment you want a second
                        pair of eyes on. Link back before the cursor moves;{" "}
                        <code>/share-trace delete</code> takes it down just as
                        fast.
                      </p>
                      <div className={styles.mini}>
                        <div className={styles.miniHead}>
                          claude-code &middot; slash command
                        </div>
                        <pre className={styles.miniBody}>
                          <span className={styles.miniCmd}>&gt; /share-trace</span>
                          {"\n"}
                          <span className={styles.miniPriv}>
                            {"  → matched PR acme/marketing-site#214"}
                          </span>
                          {"\n"}
                          <span className={styles.miniPriv}>
                            {"  → uploaded · mirrors github (private)"}
                          </span>
                          {"\n"}
                          <span className={styles.miniOk}>
                            {"  → vibeshub.ai/acme/…/8m2plq ✓"}
                          </span>
                        </pre>
                      </div>
                    </div>
                  )}
                </li>
                <li className={openWay === 2 ? styles.heroWayItemOpen : undefined}>
                  <button
                    type="button"
                    className={styles.heroWay}
                    onClick={() => toggleWay(2)}
                    aria-expanded={openWay === 2}
                  >
                    <span className={styles.heroWayMark}>
                      <IconUpload />
                    </span>
                    <div className={styles.heroWayHeading}>
                      <span className={styles.heroWayNum}>03 · Web upload</span>
                      <span className={styles.heroWayTitle}>
                        Drop a <code>.jsonl</code> on the web
                      </span>
                    </div>
                    <span className={styles.heroWayChev} aria-hidden="true">
                      <IconChevronDown />
                    </span>
                  </button>
                  {openWay === 2 && (
                    <div className={styles.heroWayPanel}>
                      <p className={styles.heroWayDesc}>
                        Publish a trace from any browser , useful when
                        the session lives on a teammate's laptop, or on a
                        machine where you'd rather not install anything.
                      </p>
                      <Link to="/upload" className={styles.dropzone}>
                        <strong>Drop transcript here</strong>
                        <br />
                        <span className={styles.dropzoneDim}>
                          .jsonl &middot; .json
                        </span>
                        <br />
                        <span className={styles.dropzoneFile}>
                          ↑ or click to choose a file
                        </span>
                      </Link>
                    </div>
                  )}
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ====================== show it off ====================== */}
        <section className={styles.showoff} id="showoff">
          <div className={`${styles.container} ${styles.showoffGrid}`}>
            <div className={styles.shareCard}>
              <div className={styles.prCommentHead}>
                <span className={styles.prAvatar}>v</span>
                <span className={styles.prAuthor}>vibeshub-bot</span>
                <span className={styles.prBotTag}>bot</span>
                <span className={styles.prTime}>commented just now</span>
              </div>
              <div className={styles.prBody}>
                <div className={styles.prTitle}>
                  Claude Code session for this PR
                </div>
                <div className={styles.prStats}>
                  <span>
                    <strong>257</strong> messages
                  </span>
                  <span className={styles.prSep}>·</span>
                  <span>
                    <strong>12</strong> file edits
                  </span>
                  <span className={styles.prSep}>·</span>
                  <span>
                    <strong>4</strong> subagents
                  </span>
                </div>
                <a
                  className={styles.prLink}
                  href={`https://vibeshub.ai/${BROWSE_FULL}/pull/69/7ntgpt45el`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className={styles.prLinkHost}>vibeshub.ai/</span>
                  <span>{BROWSE_FULL}/pull/69/7ntgpt45el</span>
                  <span className={styles.prLinkArrow}>&#x2197;</span>
                </a>
              </div>
            </div>

            <div>
              <div className={styles.eyebrow}>
                <span className={styles.dot} /> Show it off
              </div>
              <h2 className={styles.sectionTitle}>
                A trace makes a good receipt.
              </h2>
              <p className={styles.sectionLede} style={{ marginBottom: 0 }}>
                Every trace gets a stable URL with a social card. Use one
                anywhere you want the work to be legible to humans ,
                not just to your future self.
              </p>

              <ul className={styles.showoffUses}>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Receipts on a PR.</strong> The plugin drops the
                    link as a single bot comment when Claude Code opens a PR.
                    Reviewers see the actual run, not just the diff.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Brag posts.</strong> A social preview with the
                    title and tool mix , renders cleanly on X and
                    LinkedIn. Better than a screenshot of your terminal.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>On your profile.</strong> Every trace you upload
                    shows up at{" "}
                    <code>vibeshub.ai/@you</code>, alongside the repos
                    you&rsquo;ve contributed to.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Delete anytime.</strong> Change your mind?
                    Uploaders and repo admins can wipe any trace they posted
                    in one click.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ====================== browse ====================== */}
        <BrowseSection data={browse} />

        {/* ====================== privacy (access + redaction) ====================== */}
        <section className={styles.privacy} id="privacy">
          <div className={`${styles.container} ${styles.privacyGrid}`}>
            <div>
              <div className={styles.eyebrow}>
                <span className={styles.dot} /> Privacy
              </div>
              <h2 className={styles.sectionTitle}>
                Your GitHub permissions. Your secrets, stripped twice.
              </h2>
              <ul className={styles.privacyPoints}>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Visibility mirrors GitHub</strong> - public
                    stays public, private stays private.
                  </span>
                </li>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Collaborators carry over</strong> - same
                    read access as the repo, no separate ACL.
                  </span>
                </li>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Secrets stripped twice</strong> - keys,
                    tokens, and <code>KEY=value</code> shapes, on your machine
                    and on the server.
                  </span>
                </li>
              </ul>
              <p style={{ marginTop: 18 }}>
                <Link to="/privacy" className={styles.ghLink}>
                  Read the full privacy policy →
                </Link>
              </p>
            </div>

            <div className={styles.redact}>
              <div className={styles.redactHead}>
                <span className={styles.redactBadge}>redaction preview</span>
                <span className={styles.redactPath}>
                  ~/.claude/projects/web/&lt;session-id&gt;.jsonl
                </span>
              </div>
              <pre>
                <code>
                  <span className={styles.dim}>{"{"}</span>
                  {"\n  "}
                  <span className={styles.k}>"role"</span>
                  {": "}
                  <span className={styles.v}>"tool_result"</span>
                  {",\n  "}
                  <span className={styles.k}>"name"</span>
                  {": "}
                  <span className={styles.v}>"Bash"</span>
                  {",\n  "}
                  <span className={styles.k}>"output"</span>
                  {": "}
                  <span className={styles.v}>"$ env | grep API</span>
                  {"\n  GITHUB_TOKEN="}
                  <span className={styles.strike}>ghp_d4Kp9MZx2vQfJL8wB</span>
                  <span className={styles.okChip}>[redacted:gh]</span>
                  {"\n  ANTHROPIC_API_KEY="}
                  <span className={styles.strike}>sk-ant-api03-9q…</span>
                  <span className={styles.okChip}>[redacted:anth]</span>
                  {"\n  OPENAI_API_KEY="}
                  <span className={styles.strike}>sk-proj-2vF…ZxQ</span>
                  <span className={styles.okChip}>[redacted:openai]</span>
                  {"\n  AWS_SECRET="}
                  <span className={styles.strike}>aQF/9qZxV7…</span>
                  <span className={styles.okChip}>[redacted:aws]</span>
                  {'\n  USER_AGENT=vibeshub/0.3"\n'}
                  <span className={styles.dim}>{"}"}</span>
                  {"\n\n"}
                  <span className={styles.comment}>
                    // 4 patterns matched · 0 high-entropy fallbacks · safe to
                    upload
                  </span>
                </code>
              </pre>
            </div>
          </div>
        </section>

        {/* ====================== install ====================== */}
        <section className={styles.install} id="install">
          <div className={styles.container}>
            <div className={styles.eyebrow}>
              <span className={styles.dot} /> Install
            </div>
            <h2 className={styles.sectionTitle}>
              Install once. Every PR ships with a trace.
            </h2>
            <p className={styles.sectionLede}>
              Install the plugin, sign in with GitHub, and the next PR you
              open from Claude Code arrives with the session attached.
              Nothing else to learn, nothing else to run.
            </p>

            <div className={styles.installCard}>
              <div>
                <h2>Get the Claude Code plugin</h2>
                <p className={styles.installPrereq}>
                  <strong>Before you start:</strong> Claude Code, the{" "}
                  <code>gh</code> CLI authenticated with{" "}
                  <code>gh auth login</code>, and <code>python3</code> 3.9+ on
                  your <code>PATH</code>. The hook uses only the Python
                  standard library , nothing to <code>pip install</code>.
                </p>
                <div className={styles.installMeta}>
                  <span>
                    <span className={styles.key}>version</span>
                    <span className={styles.val}>{PLUGIN_VERSION}</span>
                  </span>
                  <span>
                    <span className={styles.key}>license</span>
                    <span className={styles.val}>MIT</span>
                  </span>
                  <span>
                    <span className={styles.key}>deps</span>
                    <span className={styles.val}>gh · python3</span>
                  </span>
                </div>
              </div>

              <div className={styles.codeBlock}>
                <div className={styles.codeHead}>
                  <span className={styles.label}>shell</span>
                  <span className={styles.spacer} />
                  <button
                    type="button"
                    className={`${styles.codeCopy} ${
                      copied === "install" ? styles.copied : ""
                    }`}
                    onClick={() => copy("install", INSTALL_COPY)}
                  >
                    {copied === "install" ? "copied" : "copy"}
                  </button>
                </div>
                <pre>
                  <span className={styles.commentLine}>
                    # requires: {INSTALL_PREREQS}
                  </span>
                  {"\n\n"}
                  <span className={styles.commentLine}>
                    # 1 · clone &amp; register the marketplace
                  </span>
                  {"\n"}
                  <span className={styles.prompt}>$</span>{" "}
                  <span className={styles.cmd}>git clone</span>{" "}
                  <span className={styles.arg}>
                    https://github.com/Bhavya6187/vibeshub.git
                  </span>
                  {"\n"}
                  <span className={styles.cmd}>/plugin marketplace add</span>{" "}
                  <span className={styles.arg}>./vibeshub</span>
                  {"\n\n"}
                  <span className={styles.commentLine}>
                    # 2 · install the plugin inside Claude Code
                  </span>
                  {"\n"}
                  <span className={styles.cmd}>/plugin install</span>{" "}
                  <span className={styles.arg}>vibeshub@vibeshub</span>
                  {"\n\n"}
                  <span className={styles.commentLine}>
                    # 3 · that's it - next time Claude Code runs 'gh pr create'
                  </span>
                  {"\n"}
                  <span className={styles.prompt}>$</span>{" "}
                  <span className={styles.cmd}>gh pr create</span>{" "}
                  <span className={styles.arg}>--fill</span>
                  {"\n"}
                  <span className={styles.echo}>
                    {"  ↳ vibeshub: redacted · uploaded · commented on #482 ✓"}
                  </span>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* ====================== footer ====================== */}
        <footer className={styles.footer}>
          <div className={`${styles.container} ${styles.footerInner}`}>
            <div className={styles.blurb}>
              vibeshub · public &amp; private viewer for Claude Code traces
            </div>
            <div className={styles.footerLinks}>
              <a href="https://github.com/Bhavya6187/vibeshub">GitHub</a>
              <a href="#browse">Browse</a>
              <Link to="/privacy">Privacy</Link>
              <a href="#install">Install</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ---------- browse section (uses real vibeshub repo data) ---------- */

interface BrowseSectionProps {
  data: RepoOverview | null;
}

function BrowseSection({ data }: BrowseSectionProps) {
  const traces = data?.traces?.slice(0, BROWSE_MAX) ?? [];
  const contributors = data?.contributors?.slice(0, 5) ?? [];

  return (
    <section className={styles.feed} id="browse">
      <div className={styles.container}>
        <div className={styles.eyebrow}>
          <span className={styles.dot} /> Browse public
        </div>
        <h2 className={styles.sectionTitle}>
          What we&rsquo;re sharing on{" "}
          <Link to={`/${BROWSE_FULL}`} className={styles.repoLink}>
            {BROWSE_FULL}
          </Link>
          .
        </h2>
        <p className={styles.sectionLede}>
          Each card is a real Claude Code session. Open one to see the
          prompts, tool calls, and reasoning behind the PR.
        </p>

        <div className={styles.statsStrip}>
          <StatCell
            label="Public traces"
            value={data ? compactCount(data.stats.trace_count) : "-"}
            sub={
              data && data.stats.last_trace_at
                ? `latest ${relativeWhen(data.stats.last_trace_at)}`
                : "loading"
            }
          />
          <StatCell
            label="PRs covered"
            value={data ? compactCount(data.stats.pr_count) : "-"}
            sub="with a trace attached"
          />
          <StatCell
            label="Messages"
            value={data ? compactCount(data.stats.message_count) : "-"}
            sub="across all sessions"
          />
          <StatCell
            label="Contributors"
            value={data ? compactCount(data.stats.contributor_count) : "-"}
            sub="who shared a trace"
          />
        </div>

        <div className={styles.feedGrid}>
          <div className={styles.traceList}>
            {traces.length === 0 && (
              <div className={styles.traceListEmpty}>
                {data ? "No public traces yet." : "Loading public traces…"}
              </div>
            )}
            {traces.map((t) => (
              <BrowseRow key={t.short_id} trace={t} />
            ))}
            {data && data.stats.trace_count > traces.length && (
              <Link to={`/${BROWSE_FULL}`} className={styles.traceListMore}>
                See all {compactCount(data.stats.trace_count)} traces →
              </Link>
            )}
          </div>

          <aside className={styles.feedSide}>
            <div className={styles.sideCard}>
              <div className={styles.sideCardHead}>
                <h4>Top uploaders</h4>
                <span className={styles.ct}>{BROWSE_FULL}</span>
              </div>
              <div className={styles.sideCardBody}>
                {contributors.length === 0 && (
                  <div className={styles.sideEmpty}>
                    {data ? "No uploads yet." : "Loading…"}
                  </div>
                )}
                {contributors.map((c, i) => (
                  <Link
                    key={c.login}
                    to={`/${c.login}`}
                    className={styles.contribRow}
                  >
                    <ContribAvatar login={c.login} idx={i} />
                    <span className={styles.contribName}>@{c.login}</span>
                    <span className={styles.contribCount}>
                      {c.trace_count}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className={styles.sideCard}>
              <div className={styles.sideCardHead}>
                <h4>Platforms</h4>
                <span className={styles.ct}>supported</span>
              </div>
              <div className={styles.sideCardBody}>
                <div className={styles.contribRow}>
                  <span
                    className={styles.contribAvatar}
                    style={{ background: "oklch(0.66 0.13 50)" }}
                  >
                    cc
                  </span>
                  <span className={styles.contribName}>claude-code</span>
                  <span className={styles.contribCountTag}>active</span>
                </div>
                <div
                  className={`${styles.contribRow} ${styles.contribRowDim}`}
                >
                  <span
                    className={styles.contribAvatar}
                    style={{ background: "var(--text-faint)" }}
                  >
                    cx
                  </span>
                  <span className={styles.contribName}>codex</span>
                  <span className={styles.contribCountTag}>contribute</span>
                </div>
                <div
                  className={`${styles.contribRow} ${styles.contribRowDim}`}
                >
                  <span
                    className={styles.contribAvatar}
                    style={{ background: "var(--text-faint)" }}
                  >
                    cu
                  </span>
                  <span className={styles.contribName}>cursor</span>
                  <span className={styles.contribCountTag}>contribute</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function StatCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className={styles.statCell}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statSub}>{sub}</div>
    </div>
  );
}

function BrowseRow({ trace }: { trace: TraceSummary }) {
  const sizeKb = Math.max(1, Math.round(trace.byte_size / 1024));
  return (
    <Link
      className={styles.traceRow}
      to={
        trace.repo_full_name && trace.pr_number != null
          ? `/${trace.repo_full_name}/pull/${trace.pr_number}/${trace.short_id}`
          : `/t/${trace.short_id}`
      }
    >
      <span className={`${styles.traceIcon} ${styles.iconBash}`}>
        <IconTerminal />
      </span>
      <div className={styles.traceRowBody}>
        <div className={styles.traceRowTop}>
          {trace.repo_full_name && (
            <span className={`${styles.ref} ${styles.refRepo}`}>
              {trace.repo_full_name}
            </span>
          )}
          {trace.pr_number != null ? (
            <span className={styles.ref}>#{trace.pr_number}</span>
          ) : (
            <span className={`${styles.ref} ${styles.refManual}`}>manual</span>
          )}
          <span className={styles.tTitle}>
            {trace.pr_title ??
              (trace.pr_number != null
                ? `PR #${trace.pr_number}`
                : `Trace ${trace.short_id}`)}
          </span>
        </div>
        <div className={styles.tMeta}>
          <span className={`${styles.tag} ${styles.tagBash}`}>
            <span className={styles.tagDot} />
            {trace.platform}
          </span>
          <span className={styles.sep}>·</span>
          <span>{trace.message_count} msgs</span>
          <span className={styles.sep}>·</span>
          <span>{sizeKb} KB</span>
          <span className={styles.sep}>·</span>
          <span className={styles.uploader}>
            <span className={styles.av} />@{trace.owner_login}
          </span>
        </div>
      </div>
      <div className={styles.traceRowRight}>
        <span>{relativeWhen(trace.created_at)}</span>
        <span>{trace.short_id}</span>
      </div>
    </Link>
  );
}

function ContribAvatar({ login, idx }: { login: string; idx: number }) {
  const gradients = [
    "linear-gradient(135deg,oklch(0.62 0.10 235),oklch(0.55 0.13 290))",
    "linear-gradient(135deg,oklch(0.60 0.10 150),oklch(0.62 0.13 75))",
    "linear-gradient(135deg,oklch(0.66 0.13 50),oklch(0.55 0.10 290))",
    "linear-gradient(135deg,oklch(0.58 0.13 290),oklch(0.62 0.13 340))",
    "linear-gradient(135deg,oklch(0.62 0.13 340),oklch(0.62 0.10 200))",
  ];
  return (
    <span
      className={styles.contribAvatar}
      style={{ background: gradients[idx % gradients.length] }}
    >
      {login.charAt(0).toLowerCase()}
    </span>
  );
}

/* ---------- inline icons ---------- */

function ArrowRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 5 5 9-11" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function IconPrSvg() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <line x1="6" y1="9" x2="6" y2="21" />
    </svg>
  );
}

function IconGlobeMini() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </svg>
  );
}

function IconGithub() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.02c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39s1.97.13 2.89.39c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 10l5 5 5-5" />
    </svg>
  );
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function IconLinkedIn() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67h-3.55V9h3.4v1.56h.05c.47-.9 1.63-1.85 3.35-1.85 3.58 0 4.24 2.36 4.24 5.42v6.32zM5.34 7.43A2.06 2.06 0 1 1 5.34 3.3a2.06 2.06 0 0 1 0 4.13zm1.78 13.02H3.56V9h3.56z" />
    </svg>
  );
}

function IconComment() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
