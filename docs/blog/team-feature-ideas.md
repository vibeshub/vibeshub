# Team feature ideas for vibeshub

Companion notes to the "vibeshub for teams" post. These are kept out of the post on purpose, so it stays grounded in what ships today. Each item is rated by leverage for team collaboration and rough build effort, and grounded in what already exists in the codebase.

## P0: highest leverage, build next

### 1. Trace digest (AI summary) in the PR comment and trace header
A short auto-generated "what the agent did and why": the ask, the key decisions, files touched, tests added, and any dead ends. Goes at the top of the trace and into the PR comment body.

- **Why:** This is the single biggest accelerant for the "review starts from intent" workflow. Reviewers and leads triage in seconds instead of skimming 257 messages. It also makes the PR comment useful on its own, before anyone clicks through.
- **Effort:** Medium. One LLM pass over the stored transcript at upload time; cache the result on the trace record. The comment-posting path already exists.

### 2. Deep-linkable trace steps
Give every message and tool card a stable anchor and reflect it in the URL hash, so a reviewer can link "see why, here" straight to a moment in the trace from a PR comment or Slack.

- **Why:** Today you can only link the whole trace. Review conversations are about specific moments ("why this hunk"), and a link to the exact step turns a paragraph of explanation into one click. Cheap, and it makes every other surface (comments, Slack, dashboards) more precise.
- **Effort:** Low to medium. The viewer already renders discrete steps; needs stable IDs plus scroll-to-hash on load.

### 3. Cross-trace search within a repo and org
Full-text search over prompts and tool calls, scoped to a repo or org ("how did we handle the Stripe webhook retry").

- **Why:** The searchable archive is the headline team benefit, but an archive is only as good as its findability. Right now it is browsable, not searchable. This is what turns "we have all our sessions" into "we can actually answer questions from them."
- **Effort:** Medium to high. Needs an index (Postgres full-text to start, dedicated search later) and respect for the existing GitHub-mirrored access gating in results.

## P1: strong team value, second wave

### 4. Org / team dashboard
A per-org view: traces over time, review coverage (percent of agent-authored PRs that have a trace attached), top contributors, agent mix (Claude Code / Codex / Cursor), most-active repos.

- **Why:** This is the leader's adoption metric. "Are we actually doing this, and is it spreading" is the question every eng lead asks after week one. The per-repo and per-user stats already exist (`RepoOverview`, contributors, stats strip), so this is largely aggregation and a new route.
- **Effort:** Medium.

### 5. Trace annotations anchored to steps
Let reviewers leave comments on specific trace steps, or check off "I read the reasoning for the auth change." Turns the trace from a read-only artifact into a review surface.

- **Why:** Closes the loop between reading the trace and recording the review. Pairs naturally with deep-linkable steps (P0 #2). Moves some review discussion onto the reasoning itself, which is where it belongs.
- **Effort:** Medium. New write path plus access checks; reuse the existing gating model.

### 6. GitHub Check plus optional "trace required" merge policy
Post a `vibeshub: trace attached` status check on the PR in addition to the comment, and let an org opt in to requiring a trace on agent-authored PRs before merge.

- **Why:** Gives leads a real governance lever without forcing it on anyone. Opt-in only. The check is also a cleaner signal than a comment for teams that already gate on status checks.
- **Effort:** Medium. New GitHub App/Checks integration alongside the existing comment path.

### 7. Saved / starred "exemplar vibes" with tags
Let teams star exemplary sessions and tag them ("good refactor", "migration playbook", "incident"). A curated layer on top of the raw archive.

- **Why:** The archive accumulates automatically, but the best sessions deserve to be found on purpose. This is what an onboarding doc links to. Small feature, outsized payoff for the knowledge-base story.
- **Effort:** Low to medium.

## P2: differentiators and enterprise unblockers

### 8. Diff-to-reasoning correlation
Map each changed hunk in the PR to the moment in the session where the agent wrote it. Hover a diff line, jump to "the agent added this while doing X."

- **Why:** This is the killer review feature if it lands well: it makes the diff and the reasoning a single navigable object. Highest payoff, highest risk.
- **Effort:** High. Needs to correlate edits to file state across the session; non-trivial parsing.

### 9. Slack / Teams unfurl with the digest
When a trace posts, unfurl it in the team channel with the P0 #1 digest instead of a bare link.

- **Why:** Meets teams where review discussion already happens. Mostly valuable once the digest exists.
- **Effort:** Low to medium (per platform).

### 10. Org-level custom redaction patterns and report
Let an org admin add custom redaction rules (internal hostnames, project codenames) and view a per-trace redaction report showing what was stripped.

- **Why:** Removes the last blocker for the most security-conscious teams, and the report builds trust by making the existing double-redaction visible. The redaction pipeline already runs twice; this exposes and extends it.
- **Effort:** Medium.

### 11. Embeddable trace cards
An embeddable card (or oEmbed) for internal wikis, Notion, and Confluence, so an onboarding or architecture doc can link the live session inline.

- **Why:** Pushes the archive into the docs people already read, instead of asking them to come to vibeshub.
- **Effort:** Low to medium.

---

**Suggested sequencing:** P0 #1 (digest) and #2 (deep links) unlock the most downstream value and feed almost everything below them, so do those first. #3 (search) is the biggest infra investment but the truest realization of the "searchable archive" promise the post leans on.
