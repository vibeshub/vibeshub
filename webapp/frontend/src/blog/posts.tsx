// Blog post registry. Each entry carries the post's metadata plus a `Body`
// component that renders the article prose. Adding a post = append an entry.
//
// Bodies are hand-authored TSX (not markdown) because the trace viewer's
// Markdown renderer intentionally supports neither links nor images, and posts
// need both. The wrapping <article className={styles.prose}> in BlogPost styles
// the semantic tags; figures use the shared <Figure> helper below.
import type { ComponentType } from "react";
import styles from "../routes/Blog.module.css";

export interface BlogPostMeta {
  slug: string;
  title: string;
  /** ISO yyyy-mm-dd, used for <time> and sorting. */
  date: string;
  /** Human-friendly date for display. */
  dateLabel: string;
  author: string;
  readingTime: string;
  /** Used for SEO description and the index excerpt. */
  description: string;
  excerpt: string;
  /** Absolute path under /public for the OG image + index thumbnail. */
  image: string;
  Body: ComponentType;
}

function Figure({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className={styles.figure}>
      <img src={src} alt={alt} loading="lazy" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function TeamsPostBody() {
  return (
    <>
      <p className={styles.lede}>
        Your team is writing more code than it has ever written. That is not
        the hard part anymore. The hard part is everything that comes after the
        code exists: reviewing it, trusting it, and remembering how it got
        there.
      </p>
      <p>
        A 600-line pull request that an agent produced in twenty minutes still
        lands in a human's review queue, and that human is still expected to
        understand it. The diff tells them what changed. It does not tell them
        what the author actually asked for, which approach the agent tried
        first, what it ruled out, or why it settled on the version you are
        looking at. All of that reasoning lived in the agent's chat window, and
        the moment the session closed, it was gone.
      </p>
      <p>
        So the bottleneck moved. It used to be writing the code. Now it is
        review, onboarding, and the slow erosion of context every time a
        session ends without leaving a trace. This is a playbook for teams that
        want that context back.
      </p>

      <Figure
        src="/blog/trace-viewer.png"
        alt="The vibeshub trace viewer showing a Claude Code session: hero stats, tool breakdown, an activity timeline, and the prompt rail."
        caption="A vibeshub trace: the full Claude Code or Codex session behind a single PR, replayable by anyone who can already see the repo."
      />

      <h2>What changes when the PR carries its session</h2>
      <p>
        vibeshub attaches the full AI coding session to the pull request it
        produced. The prompts, the tool calls, the reasoning, the subagents it
        spawned, the dead ends it backed out of: all of it becomes a shareable,
        replayable trace linked right on the PR.
      </p>
      <p>
        You install the plugin once, and from then on it is automatic. When
        your agent opens or updates a PR, the trace uploads itself and posts as
        a comment. Nothing changes about how your team already works. It
        supports Claude Code, Codex, and Cursor, so it does not matter which
        agent any given teammate reached for.
      </p>

      <Figure
        src="/blog/pr-comment.png"
        alt="A pull request comment from vibeshub-bot linking to the session that produced the PR, with message, file-edit, and subagent counts."
        caption="Open or update a PR and the trace posts itself as a comment. Nothing else to run."
      />

      <p>
        That one change, the session traveling with the diff, is what makes the
        workflows below possible.
      </p>

      <h2>Workflow 1: review that starts from intent, not the diff</h2>
      <p>
        The fastest way to review agent-generated code is to read the thinking
        before you read the result.
      </p>
      <p>
        <strong>Before.</strong> A reviewer opens a PR titled "refactor auth
        middleware," reads 400 lines of diff cold, and pings the author: "why
        did you switch the token refresh logic?" The author, three tasks
        downstream, tries to reconstruct a decision they made yesterday with an
        agent they no longer have open. Two days of back-and-forth later, the
        PR merges, and nobody is quite sure it was reviewed so much as approved.
      </p>
      <p>
        <strong>After.</strong> The reviewer opens the trace first. They see the
        actual prompt ("the session keeps dropping on token refresh, fix it
        without breaking SSO"), the two approaches the agent weighed, the test
        it wrote to confirm the bug existed, and the path it abandoned halfway
        through. Then they read the diff, and it reads like a conclusion they
        already understand. The questions that used to start a thread are
        already answered.
      </p>
      <p>
        Reviewers stop guessing. Round-trips drop. And the review actually
        engages with the decisions, which is where the real risk lives, instead
        of just the syntax.
      </p>

      <h2>Workflow 2: onboarding without the shoulder-tap</h2>
      <p>
        Every team has a handful of changes that new hires are told to "go read"
        to understand the system. The diff of those changes is the least useful
        version of them. It shows the final state with none of the struggle that
        explains why the system looks the way it does.
      </p>
      <p>
        A trace is the opposite. A new teammate can open the session behind a
        tricky migration and watch how it was actually built: what the author
        asked for, where the agent got stuck, which files turned out to matter,
        and what the author corrected along the way. They get the director's
        commentary, not just the final cut. That is the difference between
        reading that a decision was made and understanding why.
      </p>
      <p>
        The same archive answers the question new hires are usually too polite
        to ask out loud: "how does anyone here actually use these agents?" They
        can see it, from real sessions, instead of waiting to be shown.
      </p>

      <h2>Workflow 3: a searchable archive of how your team actually works</h2>
      <p>
        When every shipped PR keeps its session attached, each repository
        quietly becomes a browsable record of how your team builds. Not a wiki
        someone has to maintain, but a real history that accumulates on its own
        as you ship.
      </p>
      <p>
        That archive compounds. Someone figures out a clean way to drive a
        gnarly database migration with an agent, and now that session is sitting
        on the PR for the next person who has to do the same thing. The
        prompting patterns that actually worked stop living in one engineer's
        head. The plugins and agent setups that made a hard change tractable are
        visible to everyone, instead of being rediscovered cold every time.
      </p>

      <Figure
        src="/blog/archive.png"
        alt="The vibeshub repository page listing recent PRs, each with the Claude Code or Codex session that produced it, plus stats and top uploaders."
        caption="Every shipped PR keeps its session. Each repo becomes a browsable record of how the team builds."
      />

      <p>
        Teams that adopt agents quickly tend to do it the same way: they learn
        from each other's sessions instead of starting from zero. vibeshub turns
        that from a hallway conversation into something durable.
      </p>

      <h2>Workflow 4: every agent, one place</h2>
      <p>
        In most teams, agent choice is already fragmented. Some people run
        Claude Code, some run Codex, some are trying Cursor. That is fine, and
        it is not going to consolidate any time soon.
      </p>
      <p>
        vibeshub treats all of them the same. Every PR carries its session
        regardless of which agent produced it, and they all land in the same
        searchable place with the same viewer, the same redaction, and the same
        access rules. Your team's history of how it ships does not splinter
        across three tools. It stays in one archive that everyone can read.
      </p>

      <h2>Rolling it out</h2>
      <p>
        Adoption is deliberately boring, which is the point. There is no new
        account to create, no separate access control to manage, and no change
        to anyone's workflow. A developer installs the plugin once, signs in
        with the GitHub login they already have, and their next PR arrives with
        the session attached.
      </p>
      <p>
        For sessions that did not come from the automatic path, there is a{" "}
        <code>/share-trace</code> command to publish a single session on demand,
        and a web uploader where you can drop a <code>.jsonl</code> from any
        browser. But the default path is the one most of your team will ever
        touch: install, then forget it is there.
      </p>

      <h2>The governance answer</h2>
      <p>
        This is usually the first question a team lead asks, so here it is up
        front.
      </p>
      <p>
        <strong>Access mirrors GitHub, exactly.</strong> Public repositories
        produce public traces. Private repositories produce private traces,
        gated on the viewer's own GitHub access to that repo. The people who can
        already see the code can see the trace, and nobody else. There are no
        separate ACLs to keep in sync and no new accounts to provision, because
        vibeshub uses GitHub as the source of truth for who sees what.
      </p>
      <p>
        <strong>Secrets get stripped twice.</strong> Keys, tokens, JWTs, and{" "}
        <code>KEY=value</code> shapes are redacted once on the developer's
        machine before anything uploads, and again on the server before
        anything is stored. High-entropy strings get caught by a fallback pass
        even when they do not match a known pattern.
      </p>
      <p>
        And because the whole thing is open source, a security-conscious team
        can read exactly how that works, or deploy the entire stack on-prem if
        that is the requirement.
      </p>

      <h2>Start with one PR</h2>
      <p>
        You do not need a rollout plan to find out whether this helps your team.
        Install the plugin, attach a trace to your next PR, and ask the reviewer
        to open the run before they read the diff. If review gets faster and the
        questions get sharper, you will know within one change whether it is
        worth spreading.
      </p>

      <div className={styles.cta}>
        <p className={styles.ctaTitle}>Try vibeshub on your next PR</p>
        <p className={styles.ctaText}>
          If your team is drowning in agent-generated PRs that nobody can really
          review, that is exactly the pain this was built for. Try it at{" "}
          <a href="https://vibeshub.ai">vibeshub.ai</a>, read the source on{" "}
          <a href="https://github.com/vibeshub/vibeshub">GitHub</a>, or email{" "}
          <a href="mailto:bhavya@vibeshub.ai">bhavya@vibeshub.ai</a> if you want
          a hand deploying it on your own infrastructure.
        </p>
      </div>

      <p style={{ marginTop: 24 }}>Ship the vibe, not just the diff.</p>
    </>
  );
}

export const POSTS: BlogPostMeta[] = [
  {
    slug: "vibeshub-for-teams",
    title:
      "Ship the vibe, not just the diff: a playbook for teams shipping AI code",
    date: "2026-06-06",
    dateLabel: "6 June 2026",
    author: "Bhavya Agarwal",
    readingTime: "6 min read",
    description:
      "Agent-generated PRs are landing faster than any team can review them. Here is how engineering teams use vibeshub to make every AI-built change reviewable, learnable, and worth keeping.",
    excerpt:
      "Agent PRs land faster than anyone can review them, and the reasoning dies when the session closes. Four workflows for teams that want that context back: review from intent, onboarding, a searchable archive, and every agent in one place.",
    image: "/blog/trace-viewer.png",
    Body: TeamsPostBody,
  },
];

export function getPost(slug: string): BlogPostMeta | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/** Posts newest-first, for the index. */
export function postsByDate(): BlogPostMeta[] {
  return [...POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));
}
