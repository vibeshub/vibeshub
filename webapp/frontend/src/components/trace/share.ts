// One-click "Share to X" for a public trace. Pure helpers so the intent
// URL and copy are unit-testable without the DOM.

/** The fields of a trace we need to compose a share. */
export interface ShareTrace {
  platform: string;
  pr_title: string | null;
  title: string | null;
}

/** Human agent name for a platform. Mirrors the backend `_agent_label`. */
export function agentLabel(platform: string): string {
  if (platform.startsWith("codex")) return "Codex CLI";
  if (platform === "cursor") return "Cursor";
  return "Claude Code";
}

/** The prefilled tweet copy. Em-dash-free, ego-flattering, with a subject
 *  when we have one. */
export function tweetText(trace: ShareTrace): string {
  const agent = agentLabel(trace.platform);
  const subject = (trace.pr_title || trace.title || "").trim();
  if (subject) {
    return `Shipped "${subject}" with ${agent}. Here's the whole session:`;
  }
  return `Here's a ${agent} session I ran, with the whole story:`;
}

/** The X (Twitter) web intent URL. `pageUrl` is the public trace URL. */
export function tweetIntentUrl(trace: ShareTrace, pageUrl: string): string {
  const params = new URLSearchParams({ text: tweetText(trace), url: pageUrl });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}
