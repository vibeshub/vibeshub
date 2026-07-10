import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "../../components/trace/Markdown";
import { UserPrompt } from "../../components/trace/UserPrompt";

describe("redaction chips", () => {
  it("renders assistant-text markers as quiet chips", () => {
    const { container } = render(
      <Markdown text="the token is [REDACTED:high_entropy_token] now" />,
    );
    const chip = container.querySelector(".redaction-chip");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("high entropy token");
    expect(container.textContent).not.toContain("[REDACTED");
  });

  it("renders user-prompt markers as quiet chips", () => {
    const { container } = render(
      <UserPrompt
        event={{
          kind: "user_prompt",
          text: "use [REDACTED] as the key",
          ts: "2026-07-09T12:00:00Z",
          uuid: "p1",
        }}
        idx={0}
        total={1}
      />,
    );
    expect(container.querySelector(".redaction-chip")).not.toBeNull();
    expect(container.textContent).not.toContain("[REDACTED]");
  });
});
