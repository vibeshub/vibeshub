import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ViewerTopbar } from "../../components/trace/ViewerTopbar";
import type { TraceSummary } from "../../types";
import type { Session } from "../../components/trace/types";

vi.mock("../../components/ThemeToggle", () => ({ ThemeToggle: () => null }));

const session = { meta: { sessionId: "abcd1234ef" } } as unknown as Session;

function makeTrace(over: Partial<TraceSummary> = {}): TraceSummary {
  return {
    short_id: "abc7defk2j",
    owner_login: "alice",
    repo_full_name: "acme/site",
    pr_number: 482,
    pr_title: "Fix navbar overflow",
    title: null,
    platform: "claude-code",
    is_private: false,
    ...over,
  } as TraceSummary;
}

function renderTopbar(trace: TraceSummary) {
  return render(
    <MemoryRouter>
      <ViewerTopbar session={session} trace={trace} />
    </MemoryRouter>,
  );
}

describe("ViewerTopbar share", () => {
  it("offers a Share on X link for a public trace", () => {
    renderTopbar(makeTrace());
    const link = screen.getByRole("link", { name: /share on x/i });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("https://twitter.com/intent/tweet")).toBe(true);
    // searchParams.get decodes '+' to space (decodeURIComponent does not).
    const text = new URL(href).searchParams.get("text") ?? "";
    expect(text).toContain("Fix navbar overflow");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("hides the share link for a private trace", () => {
    renderTopbar(makeTrace({ is_private: true }));
    expect(screen.queryByRole("link", { name: /share on x/i })).toBeNull();
  });
});

describe("ViewerTopbar breadcrumb", () => {
  it("drops the brand word when repo crumbs are present", () => {
    render(
      <MemoryRouter>
        <ViewerTopbar
          session={session}
          trace={makeTrace()}
          repoOwner="acme"
          repoName="site"
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText("vibeshub")).toBeNull();
    expect(screen.getByText("acme")).toBeInTheDocument();
    expect(screen.getByText("site")).toBeInTheDocument();
  });

  it("keeps the brand word when there are no repo crumbs", () => {
    renderTopbar(makeTrace());
    expect(screen.getByText("vibeshub")).toBeInTheDocument();
  });
});
