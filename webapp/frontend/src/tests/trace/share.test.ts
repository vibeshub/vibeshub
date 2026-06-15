import { describe, expect, it } from "vitest";
import { agentLabel, tweetIntentUrl, tweetText } from "../../components/trace/share";

const base = { platform: "claude-code", pr_title: null, title: null };

describe("agentLabel", () => {
  it("maps platforms to human agent names", () => {
    expect(agentLabel("claude-code")).toBe("Claude Code");
    expect(agentLabel("codex")).toBe("Codex CLI");
    expect(agentLabel("cursor")).toBe("Cursor");
  });

  it("falls back to Claude Code for unknown platforms", () => {
    expect(agentLabel("something-else")).toBe("Claude Code");
  });
});

describe("tweetText", () => {
  it("uses the PR title as the subject", () => {
    const text = tweetText({ ...base, pr_title: "Fix navbar overflow" });
    expect(text).toBe(
      'Shipped "Fix navbar overflow" with Claude Code. Here\'s the whole session:',
    );
  });

  it("falls back to the trace title when there is no PR title", () => {
    const text = tweetText({ ...base, platform: "codex", title: "Refactor auth" });
    expect(text).toBe(
      'Shipped "Refactor auth" with Codex CLI. Here\'s the whole session:',
    );
  });

  it("uses a generic line when there is no subject", () => {
    expect(tweetText(base)).toBe(
      "Here's a Claude Code session I ran, with the whole story:",
    );
  });

  it("never contains an em dash", () => {
    expect(tweetText({ ...base, pr_title: "x" })).not.toContain("—");
  });
});

describe("tweetIntentUrl", () => {
  it("builds an X intent URL with encoded text and url", () => {
    const url = tweetIntentUrl(
      { ...base, pr_title: "Fix navbar" },
      "https://vibeshub.ai/acme/site/pull/482/abc7defk2j",
    );
    expect(url.startsWith("https://twitter.com/intent/tweet?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("url")).toBe(
      "https://vibeshub.ai/acme/site/pull/482/abc7defk2j",
    );
    expect(parsed.searchParams.get("text")).toContain("Fix navbar");
  });
});
