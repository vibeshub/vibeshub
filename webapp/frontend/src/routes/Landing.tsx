import { useState } from "react";
import { Link } from "react-router-dom";
import { AuthWidget } from "../components/AuthWidget";
import { IconMoon, IconSun } from "../components/trace/icons";
import { useTheme } from "../components/trace/theme";
import styles from "./Landing.module.css";
import heroTraceLight from "../assets/hero-trace-light.png";
import heroTraceDark from "../assets/hero-trace-dark.png";

// Keep in sync with plugins/claude-code/.claude-plugin/plugin.json.
const PLUGIN_VERSION = "0.2.0";
const VERSION_LABEL = `v${PLUGIN_VERSION.split(".").slice(0, 2).join(".")}`;

// What a new user needs on their machine before installing.
const INSTALL_PREREQS = "Claude Code · gh CLI (run 'gh auth login') · python3 3.9+";

// The runnable install commands — single source of truth for the hero block,
// the #install block, and both copy buttons.
const INSTALL_STEPS = [
  "git clone https://github.com/Bhavya6187/vibeshub.git",
  "/plugin marketplace add ./vibeshub",
  "/plugin install vibeshub@vibeshub",
];
const INSTALL_COPY = INSTALL_STEPS.join("\n");

// The real Claude Code trace featured in the hero — PR #31's trace.
// The screenshots in ../assets are hand-captured by scripts/capture-hero-trace.mjs;
// re-capture them if the trace viewer's design changes.
const HERO_TRACE_URL =
  "https://vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq";
const HERO_TRACE_LABEL =
  "vibeshub.ai/Bhavya6187/vibeshub/pull/31/66jxlxariq";

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

export function Landing() {
  const { resolved, toggle } = useTheme();
  const { copied, copy } = useCopy();
  const heroShot = resolved === "dark" ? heroTraceDark : heroTraceLight;

  return (
    <div className={`page-shell ${styles.shell}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <span className="brand-mark">v</span>
            <span>vibeshub</span>
          </Link>
          <span className="brand-sep">/</span>
          <span className={styles.tagline}>public viewer</span>

          <div className="topbar-spacer" />

          <nav className={`${styles.navLinks} ${styles.hideSm}`}>
            <a href="#how">How it works</a>
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
                <span>Built for Claude Code · others plug in the same way</span>
              </div>
              <h1 className={styles.heroH1}>
                Every PR has<br />
                a story. <span className={styles.hl}>Read it.</span>
              </h1>
              <p className={styles.heroSub}>
                A pull request shows you the diff. vibeshub shows you the Claude
                Code session that produced it — replay how the feature was
                actually built, tool by tool, edit by edit, retry by retry.
              </p>
              <div className={styles.heroActions}>
                <a className={`${styles.btn} ${styles.btnPrimary}`} href="#how">
                  See how it works
                  <ArrowRight />
                </a>
                <a
                  className={`${styles.btn} ${styles.btnGhost}`}
                  href="#privacy"
                >
                  Privacy &amp; redaction
                </a>
              </div>
              <div className={styles.heroInstall}>
                <div className={styles.heroInstallHead}>
                  <span className={styles.heroInstallLabel}>install</span>
                  <span className={styles.heroInstallSpacer} />
                  <button
                    type="button"
                    className={`${styles.copyBtn} ${
                      copied === "hero" ? styles.copied : ""
                    }`}
                    onClick={() => copy("hero", INSTALL_COPY)}
                  >
                    {copied === "hero" ? "copied" : "copy"}
                  </button>
                </div>
                <pre className={styles.heroInstallBody}>
                  <span className={styles.cmt}>
                    # needs: {INSTALL_PREREQS}
                  </span>
                  {"\n\n"}
                  <span className={styles.cmt}># 1 · clone the repo</span>
                  {"\n"}
                  <span className={styles.prompt}>$ </span>
                  {INSTALL_STEPS[0]}
                  {"\n\n"}
                  <span className={styles.cmt}>
                    # 2 · inside Claude Code — register, then install
                  </span>
                  {"\n"}
                  {INSTALL_STEPS[1]}
                  {"\n"}
                  {INSTALL_STEPS[2]}
                  {"\n\n"}
                  <span className={styles.cmt}>
                    # from now on, Claude Code's PRs auto-attach a trace ✓
                  </span>
                </pre>
              </div>
            </div>

            {/* right: a real PR comment + a screenshot of the trace it links to */}
            <div className={styles.heroVisual}>
              <div className={styles.ghComment}>
                <div className={styles.ghHead}>
                  <img
                    className={styles.ghAvatar}
                    src="https://github.com/Bhavya6187.png?size=64"
                    alt=""
                    width={22}
                    height={22}
                  />
                  <span className={styles.ghUser}>Bhavya6187</span>
                  <span className={styles.ghMeta}>commented on PR #31</span>
                </div>
                <div className={styles.ghBody}>
                  Claude Code trace for this PR:{" "}
                  <a className={styles.ghLink} href={HERO_TRACE_URL}>
                    {HERO_TRACE_LABEL}
                  </a>
                  <br />
                  <span style={{ color: "var(--text-muted)" }}>
                    Uploaded by the PR author.
                  </span>
                </div>
              </div>

              <div className={styles.heroArrow} aria-hidden="true">
                <svg
                  viewBox="0 0 18 36"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 2v30" strokeDasharray="2 3" />
                  <path d="M3 27l6 6 6-6" />
                </svg>
              </div>

              <a className={styles.traceCard} href={HERO_TRACE_URL}>
                <span className={styles.tracePin}>live trace</span>
                <div className={styles.traceHead}>
                  <div className={styles.dots}>
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className={styles.urlChip}>{HERO_TRACE_LABEL}</div>
                </div>
                <img
                  className={styles.traceShot}
                  src={heroShot}
                  alt="vibeshub trace viewer showing the Claude Code session that built pull request #31"
                />
              </a>
            </div>
          </div>
        </section>

        {/* ====================== how it works ====================== */}
        <section className={styles.how} id="how">
          <div className={styles.container}>
            <div className={styles.eyebrow}>
              <span className={styles.dot} /> How it works
            </div>
            <h2 className={styles.sectionTitle}>
              You open a PR. The trace shares itself.
            </h2>
            <p className={styles.sectionLede}>
              Nothing new to learn. Open a pull request from Claude Code the way
              you always do — vibeshub captures the session, removes anything
              sensitive, and links it from the PR. Your GitHub login is the only
              account you need.
            </p>

            <div className={styles.howFlow}>
              <article className={styles.flowStep}>
                <span className={styles.flowNum}>01 · CAPTURE</span>
                <div className={styles.flowIcon}>
                  <IconTerminal />
                </div>
                <h3 className={styles.flowTitle}>It captures itself</h3>
                <p className={styles.flowText}>
                  Whenever Claude Code opens a pull request for you, vibeshub
                  grabs the session behind it — straight from your machine, the
                  moment the PR goes up, with no extra step from you.
                </p>
                <span className={styles.flowTag}>
                  <span className={styles.k}>auto·</span> on every PR
                </span>
              </article>

              <article className={styles.flowStep}>
                <span className={styles.flowNum}>02 · REDACT</span>
                <div className={styles.flowIcon}>
                  <IconShield />
                </div>
                <h3 className={styles.flowTitle}>Secrets stay yours</h3>
                <p className={styles.flowText}>
                  Before anything is uploaded, vibeshub strips out API keys,
                  tokens, and passwords — then checks again on the server.
                  Teammates see your work, never your credentials.
                </p>
                <span className={styles.flowTag}>
                  <span className={styles.k}>safe·</span> redacted twice
                </span>
              </article>

              <article className={styles.flowStep}>
                <span className={styles.flowNum}>03 · SHARE</span>
                <div className={styles.flowIcon}>
                  <IconGlobe />
                </div>
                <h3 className={styles.flowTitle}>A link on the PR</h3>
                <p className={styles.flowText}>
                  vibeshub adds one comment to the pull request with a link.
                  Click it and the whole session opens on a single page — every
                  prompt, edit, and decision, ready to share.
                </p>
                <span className={styles.flowTag}>
                  <span className={styles.k}>url·</span> vibeshub.ai/
                  <span className={styles.accent}>
                    {"{owner}/{repo}/pull/{n}/{id}"}
                  </span>
                </span>
              </article>
            </div>
          </div>
        </section>

        {/* ====================== privacy ====================== */}
        <section className={styles.privacy} id="privacy">
          <div className={`${styles.container} ${styles.privacyGrid}`}>
            <div>
              <div className={styles.eyebrow}>
                <span className={styles.dot} /> Privacy &amp; redaction
              </div>
              <h2 className={styles.sectionTitle}>
                Only as public as your repo. Your secrets, never.
              </h2>
              <p className={styles.sectionLede} style={{ marginBottom: 0 }}>
                A trace inherits its repo's visibility — public repos make
                public traces, private repos make traces only people with repo
                access can open. Either way, secrets are scrubbed before upload
                and again before storage, and you can delete any trace you've
                posted at any time.
              </p>

              <ul className={styles.privacyPoints}>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Visibility follows your repo.</strong> A trace from
                    a public repo is public; a trace from a private repo opens
                    only for people with access to that repo.
                  </span>
                </li>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Secrets get stripped out.</strong> API keys, access
                    tokens, and passwords — from GitHub, AWS, OpenAI, Anthropic
                    and more — are caught and removed before anything is shared.
                  </span>
                </li>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Checked twice.</strong> Once on your machine before
                    upload, once on our server before storage. If one pass
                    misses something, the other catches it.
                  </span>
                </li>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>No new account.</strong> vibeshub signs you in with
                    your existing GitHub login — nothing extra to create, no
                    second password to manage.
                  </span>
                </li>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Undo anytime.</strong> Change your mind about a
                    trace? Take it down with{" "}
                    <code>/share-pr delete &lt;pr-url&gt;</code> — and only the
                    person who posted it can.
                  </span>
                </li>
              </ul>
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
                  {'\n  USER_AGENT=vibeshub/0.1"\n'}
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
            <h2 className={styles.sectionTitle}>Two minutes, one marketplace.</h2>
            <p className={styles.sectionLede}>
              Drop the plugin into Claude Code, keep using your existing{" "}
              <code>gh</code> auth, and the next time Claude Code opens a PR
              with <code>gh pr create</code> it auto-attaches a trace.
            </p>

            <div className={styles.installCard}>
              <div>
                <h2>Get the Claude Code plugin</h2>
                <p>
                  The plugin wires a <code>PostToolUse</code> hook plus a{" "}
                  <code>/share-pr</code> slash command for manual uploads and
                  deletions. Installing the plugin is consent for upload.
                </p>
                <p className={styles.installPrereq}>
                  <strong>Before you start:</strong> Claude Code, the{" "}
                  <code>gh</code> CLI authenticated with{" "}
                  <code>gh auth login</code>, and <code>python3</code> 3.9+ on
                  your <code>PATH</code>. The hook uses only the Python standard
                  library — nothing to <code>pip install</code>.
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
                    # 3 · that's it — next time Claude Code runs 'gh pr create'
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
              vibeshub · public viewer for Claude Code traces
            </div>
            <div className={styles.footerLinks}>
              <a href="https://github.com/Bhavya6187/vibeshub">GitHub</a>
              <a href="#how">How it works</a>
              <a href="#privacy">Privacy</a>
              <a href="#install">Install</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ---------- inline icons (kept local so the marketing page is self-contained) ---------- */

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

function IconShield() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
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
