import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthWidget } from "../components/AuthWidget";
import { SeoHead } from "../components/SeoHead";
import { IconMoon, IconSun } from "../components/trace/icons";
import { useTheme } from "../components/trace/theme";
import { fetchRepoOverview } from "../api";
import type { RepoOverview, TraceSummary } from "../types";
import styles from "./Landing.module.css";

// Keep in sync with plugins/cli/.claude-plugin/plugin.json.
const PLUGIN_VERSION = "0.4.0";
const PLUGIN_MINOR_VERSION = PLUGIN_VERSION.split(".").slice(0, 2).join(".");
const VERSION_LABEL = `v${PLUGIN_MINOR_VERSION}`;

// What a new user needs on their machine before installing.
const INSTALL_PREREQS =
  "Claude Code or Codex · gh CLI (run 'gh auth login') · python3 3.9+";

// The runnable install commands - single source of truth for both copy buttons.
// Claude Code runs them as slash commands inside the CLI; Codex runs them in the
// terminal (note the different verbs: 'install' vs 'add').
const INSTALL_STEPS = [
  "/plugin marketplace add vibeshub/vibeshub",
  "/plugin install vibeshub@vibeshub",
];
const INSTALL_COPY = INSTALL_STEPS.join("\n");

const CODEX_INSTALL_STEPS = [
  "codex plugin marketplace add vibeshub/vibeshub",
  "codex plugin add vibeshub@vibeshub",
];
const CODEX_INSTALL_COPY = CODEX_INSTALL_STEPS.join("\n");

// The vibeshub repo that powers the Browse section.
const BROWSE_OWNER = "vibeshub";
const BROWSE_REPO = "vibeshub";
const BROWSE_FULL = `${BROWSE_OWNER}/${BROWSE_REPO}`;
const BROWSE_MAX = 6;

// schema.org SoftwareApplication for the homepage. Mirrors the JSON-LD baked
// into index.html (which SeoHead strips on hydration), so search engines keep
// the structured data once React takes over. Keep the two in sync.
const LANDING_JSONLD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "vibeshub",
  url: "https://vibeshub.ai",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  description:
    "Turn your Claude Code and Codex sessions, including every subagent they spawn, into shareable, replayable traces, each with an AI digest of the session. Public and private viewer with GitHub-mirrored access and automatic secret redaction.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

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
  const [openWay, setOpenWay] = useState<number | null>(0);
  const toggleWay = (i: number) => setOpenWay((cur) => (cur === i ? null : i));
  // Which agent the hero install pane shows. Defaults to Claude Code.
  const [heroAgent, setHeroAgent] = useState<"claude" | "codex">("claude");

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
      <SeoHead
        title="vibeshub · share Claude Code & Codex sessions as replayable traces"
        description="Your Claude Code and Codex sessions, including every subagent they spawn, become shareable, replayable traces, each with an AI digest of the session. Public and private viewer with GitHub-mirrored access and automatic secret redaction."
        path="/"
        bareTitle
        jsonLd={LANDING_JSONLD}
      />
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <span className="brand-mark">v</span>
            <span>vibeshub</span>
          </Link>

          <div className="topbar-spacer" />

          {/* Real destinations only: the live viewer plus Blog/FAQ (our SEO
              assets, promoted out of the footer). No in-page anchors up here.
              Privacy/Contact stay in the footer. */}
          <nav className={`${styles.navLinks} ${styles.hideSm}`}>
            <Link to="/vibeviewer">Viewer</Link>
            <Link to="/blog">Blog</Link>
            <Link to="/faq">FAQ</Link>
          </nav>

          <div className="topbar-actions">
            <a className="iconbtn cta-install" href="#install">
              Install
            </a>
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
                <span>public &amp; private &middot; for vibe coding teams</span>
              </div>
              <h1 className={styles.heroH1}>
                Don&rsquo;t just ship the diff -
                <br />
                share the <span className={styles.hl}>vibe</span>.
              </h1>
              <p className={styles.heroSub}>
                Your Claude Code and Codex sessions, including every subagent
                they spawn, become shareable, replayable traces your whole team
                can read. Reviewers and teammates see how you actually shipped
                it, not just the final diff.
              </p>
              <div className={styles.heroInstall}>
                <div className={styles.heroInstallHead}>
                  <span className={styles.heroInstallLabel}>install in</span>
                  <div
                    className={styles.heroInstallToggle}
                    role="tablist"
                    aria-label="Choose your agent"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={heroAgent === "claude"}
                      className={`${styles.heroInstallSeg} ${
                        heroAgent === "claude" ? styles.heroInstallSegOn : ""
                      }`}
                      onClick={() => setHeroAgent("claude")}
                    >
                      Claude Code
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={heroAgent === "codex"}
                      className={`${styles.heroInstallSeg} ${
                        heroAgent === "codex" ? styles.heroInstallSegOn : ""
                      }`}
                      onClick={() => setHeroAgent("codex")}
                    >
                      Codex
                    </button>
                  </div>
                  <span className={styles.spacer} />
                  <button
                    type="button"
                    className={`${styles.codeCopy} ${
                      copied === "hero-install" ? styles.copied : ""
                    }`}
                    onClick={() =>
                      copy(
                        "hero-install",
                        heroAgent === "claude" ? INSTALL_COPY : CODEX_INSTALL_COPY,
                      )
                    }
                  >
                    {copied === "hero-install" ? "copied" : "copy"}
                  </button>
                </div>
                {heroAgent === "claude" ? (
                  <pre className={styles.heroInstallBody}>
                    <span className={styles.prompt}>&gt;</span>{" "}
                    <span className={styles.cmd}>/plugin marketplace add</span>{" "}
                    <span className={styles.arg}>vibeshub/vibeshub</span>
                    {"\n"}
                    <span className={styles.prompt}>&gt;</span>{" "}
                    <span className={styles.cmd}>/plugin install</span>{" "}
                    <span className={styles.arg}>vibeshub@vibeshub</span>
                  </pre>
                ) : (
                  <pre className={styles.heroInstallBody}>
                    <span className={styles.prompt}>$</span>{" "}
                    <span className={styles.cmd}>codex plugin marketplace add</span>{" "}
                    <span className={styles.arg}>vibeshub/vibeshub</span>
                    {"\n"}
                    <span className={styles.prompt}>$</span>{" "}
                    <span className={styles.cmd}>codex plugin add</span>{" "}
                    <span className={styles.arg}>vibeshub@vibeshub</span>
                  </pre>
                )}
                <div className={styles.heroInstallNote}>
                  requires <code>gh auth login</code>
                  {heroAgent === "codex" ? " · run these in your terminal" : ""}
                </div>
              </div>
            </div>

            {/* right: how it works - compact 3-step timeline */}
            <div className={styles.heroVisual}>
              <div className={styles.eyebrow}>
                <span className={styles.dot} /> How it works
              </div>
              <ol className={styles.heroFlow}>
                <li className={styles.heroFlowStep}>
                  <span className={styles.heroFlowMark}>
                    <IconTerminal />
                  </span>
                  <div>
                    <span className={styles.heroFlowNum}>01 · Install the plugin</span>
                    <p className={styles.heroFlowText}>
                      One command in Claude Code or Codex. Your GitHub auth is
                      your vibeshub identity, nothing else to set up.
                    </p>
                  </div>
                </li>
                <li className={styles.heroFlowStep}>
                  <span className={styles.heroFlowMark}>
                    <IconPrSvg />
                  </span>
                  <div>
                    <span className={styles.heroFlowNum}>02 · Open a PR</span>
                    <p className={styles.heroFlowText}>
                      Open a PR from your Claude Code or Codex session, the way
                      you already do. Nothing changes about how you work.
                    </p>
                  </div>
                </li>
                <li className={styles.heroFlowStep}>
                  <span className={styles.heroFlowMark}>
                    <IconCheck />
                  </span>
                  <div>
                    <span className={styles.heroFlowNum}>03 · It posts itself</span>
                    <p className={styles.heroFlowText}>
                      The trace uploads and the PR comment arrives with an AI
                      digest and the link, automatically. Reviewers start from
                      the story, not message one of 257.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* ====================== pick the workflow ====================== */}
        <section className={styles.ways} id="ways">
          <div className={`${styles.container} ${styles.waysGrid}`}>
            <div className={styles.waysHead}>
              <div className={styles.eyebrow}>
                <span className={styles.dot} /> Three ways in
              </div>
              <h2 className={styles.sectionTitle}>
                Pick the workflow that fits.
              </h2>
              <p className={styles.sectionLede} style={{ marginBottom: 0 }}>
                Three ways to get a session onto vibeshub, from fully
                automatic to a one-off upload. Reach for whichever suits the
                moment, they all land in the same place.
              </p>
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
                      {openWay !== 0 && (
                        <span className={styles.heroWaySummary}>
                          Lands on the PR automatically, no extra steps.
                        </span>
                      )}
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
                        Share any session with <code>/share-trace</code>
                      </span>
                      {openWay !== 1 && (
                        <span className={styles.heroWaySummary}>
                          Share a single session on demand.
                        </span>
                      )}
                    </div>
                    <span className={styles.heroWayChev} aria-hidden="true">
                      <IconChevronDown />
                    </span>
                  </button>
                  {openWay === 1 && (
                    <div className={styles.heroWayPanel}>
                      <p className={styles.heroWayDesc}>
                        Share a single session on demand: a clever debug, a
                        tough refactor, a moment you want a second pair of eyes
                        on. Link back before the cursor moves;{" "}
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
                        Drop your <code>.jsonl</code> on the web
                      </span>
                      {openWay !== 2 && (
                        <span className={styles.heroWaySummary}>
                          Publish a trace from any browser.
                        </span>
                      )}
                    </div>
                    <span className={styles.heroWayChev} aria-hidden="true">
                      <IconChevronDown />
                    </span>
                  </button>
                  {openWay === 2 && (
                    <div className={styles.heroWayPanel}>
                      <p className={styles.heroWayDesc}>
                        Publish a trace from any browser. Useful when the
                        session lives on a teammate's laptop, or on a machine
                        where you'd rather not install anything.
                      </p>
                      <Link to="/vibeviewer" className={styles.dropzone}>
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
        </section>

        {/* ====================== collaborate (teams) ====================== */}
        <section className={styles.showoff} id="teams">
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
                {/* Mirrors the digest rows build_comment_body posts on real PRs. */}
                <div className={styles.prDigest}>
                  <div className={styles.prDigestRow}>
                    <span className={styles.prDigestKey}>Ask</span>
                    <span className={styles.prDigestVal}>
                      Add chapter navigation to the trace viewer
                    </span>
                  </div>
                  <div className={styles.prDigestRow}>
                    <span className={styles.prDigestKey}>Key decisions</span>
                    <span className={styles.prDigestVal}>
                      Reuse digest anchors as the nav spine
                    </span>
                  </div>
                  <div className={styles.prDigestRow}>
                    <span className={styles.prDigestKey}>Dead ends</span>
                    <span className={styles.prDigestVal}>
                      IntersectionObserver thrashed, switched to scroll math
                    </span>
                  </div>
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
                <span className={styles.dot} /> Collaborate
              </div>
              <h2 className={styles.sectionTitle}>
                Your team&rsquo;s work, finally legible.
              </h2>
              <p className={styles.sectionLede} style={{ marginBottom: 0 }}>
                Every PR your team ships can carry the session that produced it.
                The whole team reads how it was built, not just what changed.
              </p>

              <ul className={styles.showoffUses}>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Review starts from intent.</strong> Every trace
                    lands with an AI digest, the ask, key decisions, and dead
                    ends, plus chapters that jump straight to the moment.
                    Reviewers get the story before the diff.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Onboarding without the shoulder-tap.</strong> New
                    teammates see how tricky changes were really built, with the
                    full session as context.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Searchable team history.</strong> Every shipped PR
                    keeps its session attached, so each repo becomes a browsable
                    archive of how the team works.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Every agent, one archive.</strong> Some of the team
                    runs Claude Code, some runs Codex. Every PR carries its
                    session either way, so it all lands in one searchable place.
                  </span>
                </li>
                <li>
                  <span className={styles.mk}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Shared permissions, zero setup.</strong> Access
                    mirrors GitHub, so the right people already have visibility,
                    with no separate ACLs or accounts.
                  </span>
                </li>
              </ul>

              <p className={styles.showoffCross}>
                Working solo and just want to show off a session?{" "}
                <Link to="/vibeviewer" className={styles.ghLink}>
                  Try the vibeviewer &rarr;
                </Link>
              </p>
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
                  {`\n  USER_AGENT=vibeshub/${PLUGIN_MINOR_VERSION}"\n`}
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
              Install once. Every PR you ship comes with a trace.
            </h2>
            <p className={styles.sectionLede}>
              Install the plugin, sign in with GitHub, and the next PR you
              open from Claude Code or Codex arrives with the session attached.
              Nothing else to learn, nothing else to run.
            </p>

            <div className={styles.installCard}>
              <div>
                <h2>Get the plugin</h2>
                <p className={styles.installPrereq}>
                  <strong>Before you start:</strong> Claude Code or Codex, the{" "}
                  <code>gh</code> CLI authenticated with{" "}
                  <code>gh auth login</code>, and <code>python3</code> 3.9+ on
                  your <code>PATH</code>. The hook uses only the Python
                  standard library, nothing to <code>pip install</code>.
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

              <div className={styles.codeCol}>
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
                    # 1 · in Claude Code, add the marketplace + install
                  </span>
                  {"\n"}
                  <span className={styles.cmd}>/plugin marketplace add</span>{" "}
                  <span className={styles.arg}>vibeshub/vibeshub</span>
                  {"\n"}
                  <span className={styles.cmd}>/plugin install</span>{" "}
                  <span className={styles.arg}>vibeshub@vibeshub</span>
                  {"\n\n"}
                  <span className={styles.commentLine}>
                    # 2 · that's it - next time your agent runs 'gh pr create'
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

                <div className={styles.codexNote}>
                  <div className={styles.codexNoteHead}>
                    <span className={styles.codexNoteLabel}>
                      using codex? run these in your terminal
                    </span>
                    <span className={styles.spacer} />
                    <button
                      type="button"
                      className={`${styles.codeCopy} ${
                        copied === "codex-install" ? styles.copied : ""
                      }`}
                      onClick={() => copy("codex-install", CODEX_INSTALL_COPY)}
                    >
                      {copied === "codex-install" ? "copied" : "copy"}
                    </button>
                  </div>
                  <pre className={styles.codexNoteBody}>
                    <span className={styles.prompt}>$</span>{" "}
                    <span className={styles.cmd}>codex plugin marketplace add</span>{" "}
                    <span className={styles.arg}>vibeshub/vibeshub</span>
                    {"\n"}
                    <span className={styles.prompt}>$</span>{" "}
                    <span className={styles.cmd}>codex plugin add</span>{" "}
                    <span className={styles.arg}>vibeshub@vibeshub</span>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ====================== footer ====================== */}
        <footer className={styles.footer}>
          <div className={`${styles.container} ${styles.footerInner}`}>
            <div className={styles.blurb}>
              vibeshub · public &amp; private viewer for Claude Code &amp; Codex
              traces
            </div>
            <div className={styles.footerLinks}>
              <a href="https://github.com/vibeshub/vibeshub">GitHub</a>
              <a href="#browse">Browse</a>
              <Link to="/vibeviewer">Viewer</Link>
              <Link to="/blog">Blog</Link>
              <Link to="/faq">FAQ</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/contact">Contact</Link>
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
          vibeshub, built with{" "}
          <Link to={`/${BROWSE_FULL}`} className={styles.repoLink}>
            vibeshub
          </Link>
          .
        </h2>
        <p className={styles.sectionLede}>
          Every PR here shipped with the Claude Code or Codex session that
          produced it. Open a card to read the prompts, tool calls, and
          reasoning behind the diff.
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
                <div className={styles.contribRow}>
                  <span
                    className={styles.contribAvatar}
                    style={{ background: "var(--tool-agent)" }}
                  >
                    cx
                  </span>
                  <span className={styles.contribName}>codex</span>
                  <span className={styles.contribCountTag}>active</span>
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
