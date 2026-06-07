import { useState } from "react";
import { Link } from "react-router-dom";
import { PageTopbar } from "../components/PageTopbar";
import { SeoHead } from "../components/SeoHead";
import styles from "./Faq.module.css";

// FAQ content for /faq. Grounded in vibeshub facts (mirrors the install steps,
// redaction patterns, and visibility model used on the landing and privacy
// pages). Edit FAQ_GROUPS to change questions/answers.
//
// Answers render as an accordion but the panels are ALWAYS in the DOM (collapse
// is CSS-only). This page exists for SEO, so every answer must be present in the
// rendered HTML even while visually collapsed.
interface FaqItem {
  question: string;
  answer: React.ReactNode;
}

interface FaqGroup {
  title: string;
  items: FaqItem[];
}

const FAQ_GROUPS: FaqGroup[] = [
  {
    title: "Getting started",
    items: [
      {
        question: "What is vibeshub?",
        answer: (
          <p>
            vibeshub turns your Claude Code and Codex sessions, including every
            subagent they spawn, into shareable, replayable traces. Instead of
            reviewing only the final diff, teammates can open the actual run: the
            prompts, tool calls, and reasoning behind how a change was shipped.
          </p>
        ),
      },
      {
        question: "How does a trace get from my terminal to a teammate?",
        answer: (
          <p>
            You work exactly the way you already do. When you open or update a PR
            from a Claude Code or Codex session, the plugin uploads the trace and
            posts a link back on the PR as a comment, automatically. Reviewers
            see how you built it before they read the diff.
          </p>
        ),
      },
      {
        question: "What are the ways to share a session?",
        answer: (
          <>
            <p>There are three ways, from fully automatic to a one-off upload:</p>
            <ul>
              <li>
                <strong>Automatic</strong>: a trace posts on every PR you open or
                update.
              </li>
              <li>
                <strong>Slash command</strong>: share any session on demand with{" "}
                <code>/share-trace</code>.
              </li>
              <li>
                <strong>Web upload</strong>: drop your <code>.jsonl</code> session
                file in the browser to publish a trace from anywhere.
              </li>
            </ul>
            <p>They all land in the same place.</p>
          </>
        ),
      },
      {
        question: "What do I need before installing?",
        answer: (
          <p>
            Claude Code or Codex, the <code>gh</code> CLI authenticated with{" "}
            <code>gh auth login</code>, and <code>python3</code> 3.9+ on your{" "}
            <code>PATH</code>. The hook uses only the Python standard library, so
            there is nothing to <code>pip install</code>.
          </p>
        ),
      },
    ],
  },
  {
    title: "Compatibility",
    items: [
      {
        question: "Does it work with Claude Code and the Anthropic CLI?",
        answer: (
          <>
            <p>
              Yes. vibeshub is built for Claude Code first. Install it as a plugin
              from inside the CLI:
            </p>
            <pre className={styles.code}>
              {`> /plugin marketplace add vibeshub/vibeshub
> /plugin install vibeshub@vibeshub`}
            </pre>
            <p>
              After that, the next time your agent runs <code>gh pr create</code>{" "}
              the trace is redacted, uploaded, and commented on the PR
              automatically.
            </p>
          </>
        ),
      },
      {
        question: "Does it support Codex too?",
        answer: (
          <>
            <p>
              Yes. Some teams run Claude Code, some run Codex. Every PR carries
              its session either way, and it all lands in one searchable archive.
              From your terminal:
            </p>
            <pre className={styles.code}>
              {`$ codex plugin marketplace add vibeshub/vibeshub
$ codex plugin add vibeshub@vibeshub`}
            </pre>
          </>
        ),
      },
      {
        question: "Are subagents captured too?",
        answer: (
          <p>
            Yes. A trace includes the full session, including every subagent your
            primary agent spawns, so reviewers see the complete picture of how a
            change was actually built, not just the top-level conversation.
          </p>
        ),
      },
      {
        question: "Do I need a separate account?",
        answer: (
          <p>
            No. Your GitHub auth is your vibeshub identity, there is nothing else
            to set up. Sign in with GitHub and the next PR you open from Claude
            Code or Codex arrives with the session attached.
          </p>
        ),
      },
    ],
  },
  {
    title: "Privacy & visibility",
    items: [
      {
        question: "Who can see my traces?",
        answer: (
          <p>
            Visibility mirrors GitHub. A trace from a public repo stays public; a
            trace from a private repo stays private. Collaborators carry over, so
            the same people who can read the repo can read the trace, with no
            separate access list to manage.
          </p>
        ),
      },
      {
        question: "Do I have to set up separate permissions or ACLs?",
        answer: (
          <p>
            No. Access mirrors GitHub, so the right people already have visibility
            with zero setup. There are no separate vibeshub ACLs or accounts to
            provision for your team.
          </p>
        ),
      },
      {
        question: "Can I share a session without opening a PR?",
        answer: (
          <p>
            Yes. Use the <code>/share-trace</code> slash command to publish a
            single session on demand, or drop a <code>.jsonl</code> file on the
            web. These are handy for solo work or showing off a run; for that, try
            the <Link to="/vibeviewer">vibeviewer</Link>.
          </p>
        ),
      },
    ],
  },
  {
    title: "Data security & redaction",
    items: [
      {
        question: "How are my secrets handled?",
        answer: (
          <p>
            Secrets are stripped once on your machine before anything leaves, and
            again on the server. Redaction catches API keys, tokens, and{" "}
            <code>KEY=value</code> shapes so they never appear in a published
            trace.
          </p>
        ),
      },
      {
        question: "What kinds of secrets does redaction catch?",
        answer: (
          <>
            <p>
              Common credential patterns are matched and replaced inline before
              upload, for example:
            </p>
            <pre className={styles.code}>
              {`GITHUB_TOKEN=ghp_d4Kp9MZx2vQfJL8wB[redacted:gh]
ANTHROPIC_API_KEY=sk-ant-api03-9q…[redacted:anth]
OPENAI_API_KEY=sk-proj-2vF…ZxQ[redacted:openai]
AWS_SECRET=aQF/9qZxV7…[redacted:aws]`}
            </pre>
            <p>
              Known provider patterns are matched first, with a high-entropy
              fallback for anything else that looks like a secret.
            </p>
          </>
        ),
      },
      {
        question: "Does redaction run before the trace leaves my machine?",
        answer: (
          <p>
            Yes. The first redaction pass runs locally, so secrets are stripped on
            your machine before upload. A second pass runs on the server as a
            backstop. The local hook relies only on the Python standard library.
          </p>
        ),
      },
    ],
  },
  {
    title: "Managing shared sessions",
    items: [
      {
        question: "How do I manage who can see a trace after it's shared?",
        answer: (
          <p>
            Because visibility mirrors GitHub, you manage trace access through the
            repo it came from. Changing a repo's visibility or its collaborator
            list changes who can read the attached traces, with no separate
            permission layer to keep in sync.
          </p>
        ),
      },
      {
        question: "Can I delete a session I've shared?",
        answer: (
          <p>
            Yes. Traces are tied to your GitHub identity, so you can remove a
            trace you published. Inside Claude Code, run{" "}
            <code>/share-trace delete</code> with the PR url, the trace url, or its
            short id; only the original uploader can delete a trace.
          </p>
        ),
      },
      {
        question: "How do I stop new traces from being uploaded?",
        answer: (
          <>
            <p>You have a few options depending on how far you want to go:</p>
            <ul>
              <li>
                Skip a single PR by not using the automatic flow, sharing
                intentionally with <code>/share-trace</code> instead.
              </li>
              <li>Uninstall the plugin to stop automatic uploads entirely.</li>
              <li>
                Revoke the GitHub auth the plugin uses to cut off its access.
              </li>
            </ul>
          </>
        ),
      },
      {
        question: "Something isn't covered here. How do I get it removed?",
        answer: (
          <p>
            For takedown or access questions that aren't self-serve, reach out
            through the{" "}
            <a href="https://github.com/vibeshub/vibeshub">vibeshub GitHub repo</a>{" "}
            or email <a href="mailto:bhavya@vibeshub.ai">bhavya@vibeshub.ai</a>.
            Since access already mirrors your GitHub permissions, removing repo
            access is often the fastest first step.
          </p>
        ),
      },
    ],
  },
];

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

function FaqRow({
  id,
  item,
  open,
  onToggle,
}: {
  id: string;
  item: FaqItem;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `${id}-panel`;
  return (
    <li className={`${styles.item} ${open ? styles.itemOpen : ""}`}>
      <button
        type="button"
        className={styles.q}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className={styles.qText}>{item.question}</span>
        <span className={styles.chev} aria-hidden="true">
          <IconChevronDown />
        </span>
      </button>
      {/* Panel stays mounted (collapse is CSS-only) so answers are always in the
          rendered HTML for search crawlers. */}
      <div id={panelId} className={styles.panel} role="region">
        <div className={styles.panelInner}>{item.answer}</div>
      </div>
    </li>
  );
}

export function Faq() {
  // Multiple questions can be open at once; default all collapsed so the page
  // reads as a scannable list of questions.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="page-shell">
      <SeoHead
        title="FAQ"
        description="Answers to common questions about vibeshub: how it works with Claude Code and Codex, what happens to your traces and secrets, how visibility mirrors GitHub, and how to manage or delete a shared session."
        path="/faq"
      />
      <PageTopbar crumbs={[{ label: "FAQ", current: true }]} />

      <main className={styles.faq}>
        <header className={styles.header}>
          <div className={styles.eyebrow}>
            <span className={styles.dot} />
            <span>FAQ</span>
          </div>
          <h1 className={styles.title}>
            Everything you need to know about sharing the vibe.
          </h1>
          <p className={styles.lead}>
            How vibeshub works with Claude Code and Codex, what happens to your
            traces and secrets, and how visibility, access, and deletion are
            handled. Answered for developers.
          </p>
        </header>

        {FAQ_GROUPS.map((group, gi) => (
          <section key={group.title} className={styles.group}>
            <h2 className={styles.groupTitle}>{group.title}</h2>
            <ul className={styles.items}>
              {group.items.map((item, ii) => {
                const key = `${gi}-${ii}`;
                return (
                  <FaqRow
                    key={key}
                    id={`faq-${key}`}
                    item={item}
                    open={open.has(key)}
                    onToggle={() => toggle(key)}
                  />
                );
              })}
            </ul>
          </section>
        ))}

        <div className={styles.cta}>
          <p className={styles.ctaText}>Still have a question?</p>
          <p className={styles.ctaSub}>
            Reach the team on{" "}
            <a href="https://github.com/vibeshub/vibeshub">GitHub</a>, read the{" "}
            <Link to="/privacy">privacy policy</Link>, or{" "}
            <Link to="/contact">get in touch</Link>.
          </p>
        </div>
      </main>

      <footer className="footer">
        <span>frequently asked questions</span>
        <span>
          <Link to="/privacy">Privacy</Link> · <Link to="/contact">Contact</Link>{" "}
          · vibeshub
        </span>
      </footer>
    </div>
  );
}
