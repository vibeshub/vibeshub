import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Faq } from "../../routes/Faq";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    loading: false,
    user: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  })),
}));

function renderFaq() {
  return render(
    <MemoryRouter initialEntries={["/faq"]}>
      <Routes>
        <Route path="/faq" element={<Faq />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Faq", () => {
  it("renders the page shell with an h1 heading", () => {
    renderFaq();
    expect(
      screen.getByRole("heading", { level: 1, name: /sharing the vibe/i }),
    ).toBeInTheDocument();
  });

  it("renders each topic group heading", () => {
    renderFaq();
    const groups = [
      /getting started/i,
      /compatibility/i,
      /privacy & visibility/i,
      /data security & redaction/i,
      /managing shared sessions/i,
    ];
    for (const name of groups) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
  });

  it("renders questions as accordion toggle buttons, collapsed by default", () => {
    renderFaq();
    const toggle = screen.getByRole("button", { name: /what is vibeshub\?/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps answer copy in the DOM even while collapsed (for SEO)", () => {
    renderFaq();
    // The answer text is present in the rendered HTML without any interaction.
    expect(
      screen.getByText(/shareable, replayable traces/i),
    ).toBeInTheDocument();
  });

  it("injects FAQPage structured data with a non-empty answer per question", () => {
    renderFaq();
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    );
    expect(script).not.toBeNull();
    const data = JSON.parse(script!.textContent ?? "{}");
    expect(data["@type"]).toBe("FAQPage");

    const names = data.mainEntity.map((q: { name: string }) => q.name);
    expect(names).toContain("What is vibeshub?");
    for (const entry of data.mainEntity) {
      expect(entry["@type"]).toBe("Question");
      expect(entry.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  it("flattens multi-block answers without running words together", () => {
    renderFaq();
    const data = JSON.parse(
      document.head.querySelector('script[type="application/ld+json"]')
        ?.textContent ?? "{}",
    );
    const ways = data.mainEntity.find(
      (q: { name: string }) =>
        q.name === "What are the ways to share a session?",
    );
    // The intro <p>, the <li>s, and the closing <p> must stay separated when
    // collapsed to one string — no "upload:Automatic" run-together.
    expect(ways.acceptedAnswer.text).not.toMatch(/upload:Automatic/);
    expect(ways.acceptedAnswer.text).toContain(
      "They all land in the same place",
    );
  });
});
