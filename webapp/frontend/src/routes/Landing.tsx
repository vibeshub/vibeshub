import { useState } from "react";
import { Link } from "react-router-dom";
import { AuthWidget } from "../components/AuthWidget";
import { IconMoon, IconSun } from "../components/trace/icons";
import { useTheme } from "../components/trace/theme";
import styles from "./Landing.module.css";

const INSTALL_HERO = "/plugin install vibeshub@vibeshub";
const INSTALL_FULL = `# 1. clone & register the marketplace
$ git clone https://github.com/Bhavya6187/vibeshub.git ~/code/vibeshub

# 2. inside Claude Code
/plugin marketplace add ~/code/vibeshub
/plugin install vibeshub@vibeshub

# 3. that's it. your next 'gh pr create'…
$ gh pr create --fill
  ↳ vibeshub: redacted · uploaded · commented on #482 ✓`;

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
                <span className={styles.tag}>v0.1</span>
                <span>Built for Claude Code · others plug in the same way</span>
              </div>
              <h1 className={styles.heroH1}>
                Every PR has<br />
                a story. <span className={styles.hl}>Read it.</span>
              </h1>
              <p className={styles.heroSub}>
                vibeshub is a viewer for Claude Code conversation traces,
                attached to the pull requests they produced. Replay how a
                feature actually got built — tool by tool, edit by edit, retry
                by retry.
              </p>
              <div className={styles.heroActions}>
                <a className={`${styles.btn} ${styles.btnPrimary}`} href="#install">
                  Install the plugin
                  <ArrowRight />
                </a>
                <a className={`${styles.btn} ${styles.btnGhost}`} href="#how">
                  See how it works
                </a>
              </div>
              <div className={styles.heroCmd}>
                <span className={styles.prompt}>$</span>
                <span>claude {INSTALL_HERO}</span>
                <button
                  type="button"
                  className={`${styles.copyBtn} ${
                    copied === "hero" ? styles.copied : ""
                  }`}
                  onClick={() => copy("hero", `claude ${INSTALL_HERO}`)}
                >
                  {copied === "hero" ? "copied" : "copy"}
                </button>
              </div>
            </div>

            {/* right: stylized illustration of a PR bot comment + trace */}
            <div className={styles.heroVisual} aria-hidden="true">
              <div className={styles.ghComment}>
                <div className={styles.ghHead}>
                  <span className={styles.ghAvatar}>fc</span>
                  <span className={styles.ghUser}>feross</span>
                  <span className={styles.ghMeta}>
                    commented on PR #482 · just now
                  </span>
                </div>
                <div className={styles.ghBody}>
                  Claude Code trace for this PR:{" "}
                  <span className={styles.ghLink}>
                    vibeshub.ai/anthropics/anthropic-sdk-python/pull/482/k3p9wq
                  </span>
                  <br />
                  <span style={{ color: "var(--text-muted)" }}>
                    Uploaded by the PR author.
                  </span>
                </div>
              </div>

              <div className={styles.heroArrow}>
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

              <div className={styles.traceCard}>
                <span className={styles.tracePin}>live trace</span>
                <div className={styles.traceHead}>
                  <div className={styles.dots}>
                    <span /><span /><span />
                  </div>
                  <div className={styles.urlChip}>
                    vibeshub.ai/anthropics/anthropic-sdk-python/pull/482/k3p9wq
                  </div>
                </div>
                <div className={styles.traceBody}>
                  <h3 className={styles.traceH1}>
                    Fix flake in retriever cache TTL test
                  </h3>
                  <div className={styles.traceMeta}>
                    <span className={styles.crumb}>
                      anthropics/anthropic-sdk-python
                    </span>
                    <span className={styles.sep}>·</span>
                    <span>#482</span>
                    <span className={styles.sep}>·</span>
                    <span>claude-code</span>
                    <span className={styles.sep}>·</span>
                    <span>38 messages</span>
                    <span className={styles.sep}>·</span>
                    <span>14m 02s</span>
                  </div>

                  <div className={styles.timeline}>
                    <div
                      className={`${styles.timelineSeg} ${styles.tlRead}`}
                      style={{ flex: 0.6 }}
                    />
                    <div
                      className={`${styles.timelineSeg} ${styles.tlBash}`}
                      style={{ flex: 1.4 }}
                    />
                    <div
                      className={`${styles.timelineSeg} ${styles.tlGap}`}
                      style={{ flex: 0.15 }}
                    />
                    <div
                      className={`${styles.timelineSeg} ${styles.tlWrite}`}
                      style={{ flex: 0.9 }}
                    />
                    <div
                      className={`${styles.timelineSeg} ${styles.tlBash}`}
                      style={{ flex: 1.6 }}
                    />
                    <div
                      className={`${styles.timelineSeg} ${styles.tlAgent}`}
                      style={{ flex: 0.8 }}
                    />
                    <div
                      className={`${styles.timelineSeg} ${styles.tlWrite}`}
                      style={{ flex: 1.2 }}
                    />
                    <div
                      className={`${styles.timelineSeg} ${styles.tlBash}`}
                      style={{ flex: 1.0 }}
                    />
                  </div>

                  <div className={styles.userPromptCard}>
                    <div className={styles.upAvatar}>U</div>
                    <div className={styles.upBody}>
                      <div className={styles.upMeta}>Prompt 1 / 3</div>
                      <div className={styles.upText}>
                        The retriever cache TTL test is flaking on CI — fails
                        about 1 in 3 runs on{" "}
                        <code>test_ttl_expiry</code>. Can you reproduce and fix
                        it?
                      </div>
                    </div>
                  </div>

                  <div className={`${styles.toolCard} ${styles.toolBash}`}>
                    <div className={styles.toolHead}>
                      <span className={styles.toolDot} />
                      <span className={styles.toolName}>Bash</span>
                      <span className={styles.toolArgs}>
                        pytest tests/retriever/test_cache.py -k ttl -x
                      </span>
                      <span className={styles.toolDur}>2.41s</span>
                    </div>
                    <div className={styles.toolBody}>
                      <span className={styles.dim}>$ </span>
                      pytest tests/retriever/test_cache.py -k ttl -x
                      {"\n"}
                      <span className={styles.dim}>
                        collected 3 items · 2 passed ·{" "}
                      </span>
                      <span className={styles.err}>1 failed</span>
                      {"\n"}
                      <span className={styles.dim}>FAILED</span> test_ttl_expiry
                      — <span className={styles.err}>AssertionError</span>
                    </div>
                  </div>

                  <div className={`${styles.toolCard} ${styles.toolWrite}`}>
                    <div className={styles.toolHead}>
                      <span className={styles.toolDot} />
                      <span className={styles.toolName}>Edit</span>
                      <span className={styles.toolArgs}>
                        retriever/cache.py · monotonic → wall-clock
                      </span>
                      <span className={styles.toolDur}>0.18s</span>
                    </div>
                  </div>

                  <div
                    className={`${styles.toolCard} ${styles.toolBash}`}
                    style={{ marginBottom: 18 }}
                  >
                    <div className={styles.toolHead}>
                      <span className={styles.toolDot} />
                      <span className={styles.toolName}>Bash</span>
                      <span className={styles.toolArgs}>
                        pytest tests/retriever/ -x
                      </span>
                      <span className={styles.toolDur}>3.04s</span>
                    </div>
                    <div className={styles.toolBody}>
                      <span className={styles.dim}>$ </span>
                      pytest tests/retriever/ -x{"\n"}
                      <span className={styles.ok}>
                        ·· passed · 41 in 3.04s ✓
                      </span>
                    </div>
                  </div>
                </div>
              </div>
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
              PR comment in, public trace out.
            </h2>
            <p className={styles.sectionLede}>
              No new workflow. No new identity. Run <code>gh pr create</code>{" "}
              inside a Claude Code session and the plugin does the rest — your
              GitHub auth is your vibeshub identity.
            </p>

            <div className={styles.howFlow}>
              <article className={styles.flowStep}>
                <span className={styles.flowNum}>01 · HOOK</span>
                <div className={styles.flowIcon}>
                  <IconTerminal />
                </div>
                <h3 className={styles.flowTitle}>Hook captures the session</h3>
                <p className={styles.flowText}>
                  A <code>PostToolUse</code> hook fires the moment{" "}
                  <code>gh pr create</code> finishes in your shell. It locates
                  the matching <code>.jsonl</code> transcript on disk and reads
                  it without leaving your machine.
                </p>
                <span className={styles.flowTag}>
                  <span className={styles.k}>file·</span>{" "}
                  ~/.claude/projects/…/&lt;session-id&gt;.jsonl
                </span>
              </article>

              <article className={styles.flowStep}>
                <span className={styles.flowNum}>02 · REDACT</span>
                <div className={styles.flowIcon}>
                  <IconShield />
                </div>
                <h3 className={styles.flowTitle}>Redact, twice.</h3>
                <p className={styles.flowText}>
                  Client pass strips known secret shapes — AWS, GitHub, OpenAI,
                  and Anthropic keys, JWTs, <code>KEY=value</code> env
                  assignments, high-entropy tokens. The server runs the same
                  pass again before storage.
                </p>
                <span className={styles.flowTag}>
                  <span className={styles.k}>client +</span> server
                </span>
              </article>

              <article className={styles.flowStep}>
                <span className={styles.flowNum}>03 · PUBLISH</span>
                <div className={styles.flowIcon}>
                  <IconGlobe />
                </div>
                <h3 className={styles.flowTitle}>Linked from the PR</h3>
                <p className={styles.flowText}>
                  vibeshub stores the transcript, mints a short URL, and the
                  plugin lands a single <code>gh pr comment</code> on the pull
                  request. Anyone with the link sees the same single-page
                  viewer.
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
                Public by default, but never naked.
              </h2>
              <p className={styles.sectionLede} style={{ marginBottom: 0 }}>
                vibeshub is a public viewer. That only works if it never
                publishes a secret. Two redaction passes, plus a one-command
                kill switch on anything that slips through.
              </p>

              <ul className={styles.privacyPoints}>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Pattern-based stripping</strong> for AWS, GitHub,
                    OpenAI, and Anthropic keys, JWTs, plus high-entropy tokens
                    and <code>KEY=value</code> shapes.
                  </span>
                </li>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>Double pass.</strong> Once on your machine before
                    upload, once on the server before storage — neither pass is
                    a guarantee, so both run.
                  </span>
                </li>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>You bring the identity.</strong> The plugin
                    authenticates with your existing <code>gh auth token</code>{" "}
                    — no separate account, no second password to manage.
                  </span>
                </li>
                <li>
                  <span className={styles.ppMark}>
                    <IconCheck />
                  </span>
                  <span>
                    <strong>One-command revoke.</strong> Delete any trace you
                    uploaded with <code>/share-pr delete &lt;pr-url&gt;</code> —
                    owner is auth'd by the same <code>gh</code> token.
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
              <code>gh</code> auth, and your next <code>gh pr create</code>{" "}
              auto-attaches a trace.
            </p>

            <div className={styles.installCard}>
              <div>
                <h2>Get the Claude Code plugin</h2>
                <p>
                  The plugin wires a <code>PostToolUse</code> hook plus a{" "}
                  <code>/share-pr</code> slash command for manual uploads and
                  deletions. Installing the plugin is consent for upload.
                </p>
                <div className={styles.installMeta}>
                  <span>
                    <span className={styles.key}>version</span>
                    <span className={styles.val}>0.1.1</span>
                  </span>
                  <span>
                    <span className={styles.key}>license</span>
                    <span className={styles.val}>MIT</span>
                  </span>
                  <span>
                    <span className={styles.key}>deps</span>
                    <span className={styles.val}>gh CLI</span>
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
                    onClick={() => copy("install", INSTALL_FULL)}
                  >
                    {copied === "install" ? "copied" : "copy"}
                  </button>
                </div>
                <pre>
                  <span className={styles.commentLine}>
                    # 1. clone &amp; register the marketplace
                  </span>
                  {"\n"}
                  <span className={styles.prompt}>$</span>{" "}
                  <span className={styles.cmd}>git clone</span>{" "}
                  <span className={styles.arg}>
                    https://github.com/Bhavya6187/vibeshub.git
                  </span>{" "}
                  <span className={styles.arg}>~/code/vibeshub</span>
                  {"\n\n"}
                  <span className={styles.commentLine}>
                    # 2. inside Claude Code
                  </span>
                  {"\n"}
                  <span className={styles.cmd}>/plugin marketplace add</span>{" "}
                  <span className={styles.arg}>~/code/vibeshub</span>
                  {"\n"}
                  <span className={styles.cmd}>/plugin install</span>{" "}
                  <span className={styles.arg}>vibeshub@vibeshub</span>
                  {"\n\n"}
                  <span className={styles.commentLine}>
                    # 3. that's it. your next 'gh pr create'…
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
