import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SeoHead } from "../../components/SeoHead";

afterEach(() => {
  cleanup();
  // Wipe head between tests so leftover tags don't bleed across cases.
  document.head.innerHTML = "";
});

function seedHeadWithMarkers(staleInner: string) {
  document.head.innerHTML = `
    <meta charset="UTF-8" />
    <!--SEO_HEAD_START-->
    ${staleInner}
    <!--SEO_HEAD_END-->
  `;
}

function tagsBetweenMarkers(): Element[] {
  const walker = document.createNodeIterator(
    document.head,
    NodeFilter.SHOW_COMMENT,
  );
  let start: Comment | null = null;
  let end: Comment | null = null;
  let n: Node | null = walker.nextNode();
  while (n) {
    const c = n as Comment;
    if (c.data === "SEO_HEAD_START") start = c;
    else if (c.data === "SEO_HEAD_END") {
      end = c;
      break;
    }
    n = walker.nextNode();
  }
  if (!start || !end) return [];
  const out: Element[] = [];
  for (let s = start.nextSibling; s && s !== end; s = s.nextSibling) {
    if (s.nodeType === Node.ELEMENT_NODE) out.push(s as Element);
  }
  return out;
}

describe("SeoHead", () => {
  it("removes stale SSR tags between the SEO marker comments on mount", () => {
    seedHeadWithMarkers(
      `<title>stale title</title>
       <meta name="description" content="stale description" />`,
    );

    render(<SeoHead title="Fresh" description="Fresh description" />);

    const between = tagsBetweenMarkers();
    // Whatever is between the markers must be only what React rendered.
    // We don't assert React placed tags between the markers — React 19
    // hoists to <head> in document order — but the stale ones must be gone.
    const stale = between.filter(
      (el) =>
        (el.tagName === "TITLE" && el.textContent === "stale title") ||
        (el.tagName === "META" &&
          el.getAttribute("content") === "stale description"),
    );
    expect(stale).toEqual([]);

    // React's hoisted <title> must NOT be in the snapshot — it was rendered
    // after the lazy-init captured the stale block. This pins the invariant
    // that justifies the lazy-init approach over a plain useEffect.
    const titles = Array.from(document.head.querySelectorAll("title"));
    expect(titles.map((t) => t.textContent)).toContain("Fresh · vibeshub");
  });

  it("no-ops when the head has no SEO marker comments", () => {
    document.head.innerHTML = `<meta charset="UTF-8" />`;
    // Should not throw.
    render(<SeoHead title="A" description="B" />);
    // <head> still has the charset meta.
    expect(document.head.querySelector('meta[charset="UTF-8"]'))
      .not.toBeNull();
  });

  it("is idempotent across mount / unmount / remount", () => {
    seedHeadWithMarkers(`<title>stale</title>`);
    const { unmount } = render(
      <SeoHead title="One" description="d" />,
    );
    unmount();
    // Second mount: nothing left to strip; should still not throw.
    render(<SeoHead title="Two" description="d" />);
    const stale = tagsBetweenMarkers().filter(
      (el) => el.tagName === "TITLE" && el.textContent === "stale",
    );
    expect(stale).toEqual([]);
  });

  it("does not throw on first unmount when SSR tags are present", () => {
    // The original useEffect-only recipe crashed here: React 19's title
    // hoist adopts the SSR <title> node, and the strip effect removed it
    // out from under React's fiber tree, leading to a crash in
    // commitDeletionEffectsOnFiber during unmount. This test would have
    // caught that regression. If a future contributor "simplifies" the
    // snapshot back into a plain useEffect, this test must fail.
    seedHeadWithMarkers(
      `<title>stale title</title>
       <meta name="description" content="stale description" />`,
    );

    const { unmount } = render(
      <SeoHead title="Fresh" description="Fresh description" />,
    );

    expect(() => unmount()).not.toThrow();
  });
});
