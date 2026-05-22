# Merge the trace viewer's two sticky bars on scroll

**Date:** 2026-05-22
**Branch:** `merge-sticky-bars` (off `main`)

## Problem

The trace viewer page has two stacked bars at the top:

- **Top bar** (`ViewerTopbar`) — `v vibeshub / owner / repo / trace/<id>` breadcrumb, plus Share and theme-toggle buttons.
- **Bottom bar** (`TraceHeader`) — the PR/trace title with an optional `🔒 Private` badge, `View on GitHub` / `Raw JSONL` links, and a meta row (`#PR · platform · N messages · size · date · uploaded by`).

Both are wrapped in a single `position: sticky` container (`.viewer-header`), so when the user scrolls down, both bars stay pinned and stack — consuming two rows of vertical space for the whole session.

## Goal

When the user scrolls down, merge the two bars into a single sticky bar. The bottom bar collapses away; a compact title moves into the top bar to the **left of the breadcrumb**. At the top of the page, the two-bar layout is unchanged.

## Behavior

**At top of page (not stuck):** Identical to today — two bars, full `TraceHeader` with large title, GitHub/Raw links, and meta row.

**Scrolled down (stuck):** One merged bar. Left side reads:

```
Add repo… · v vibeshub / owner / repo / trace/1df    [GitHub] [Raw] [Share] [☾]
```

- The **compact title** (title text + `🔒` badge if private) is the leftmost element, followed by a `·` separator, then the existing full breadcrumb.
- `View on GitHub` and `Raw JSONL` cross-fade into the top bar's action cluster, alongside Share and the theme toggle (all actions kept).
- The bottom bar (`TraceHeader`) collapses: meta row and large title animate `max-height` / `opacity` / `padding` to zero and slide up.

**Transition:** Smooth collapse. `TraceHeader` animates its collapse; the compact title and compact GitHub/Raw links animate in via `max-width` / `opacity`. Honors `prefers-reduced-motion` by shortening/removing the transition.

## Approach: cross-fade duplication

The collapsed-state elements (compact title + compact GitHub/Raw links) are rendered **additionally** inside `ViewerTopbar`, hidden by default and revealed only when stuck. The original `TraceHeader` is structurally untouched and simply collapses when stuck.

This keeps the un-scrolled view byte-identical to today and is the standard collapsing-header pattern. The duplicated DOM is trivial (one title element + two links).

Rejected alternative: permanently moving `View on GitHub` / `Raw JSONL` into the top bar. Simpler, but it changes the un-scrolled layout, which is out of scope.

## Stuck detection

A zero-height sentinel `<div>` is placed immediately above `.viewer-header`. An `IntersectionObserver` (root = viewport) watches it: when the sentinel scrolls out of view, the header is stuck. No scroll-event listener. The observer toggles an `is-stuck` class on `.viewer-header`.

## Components and files

- **`TraceViewer.tsx`** — Add a sentinel `<div>` (ref) above `.viewer-header`. Add `stuck` state + a `useEffect` that wires up the `IntersectionObserver` and toggles the `is-stuck` class on `.viewer-header`. Pass `trace` to `ViewerTopbar`.
- **`ViewerTopbar.tsx`** — Accept a new `trace` prop. Render a compact `.topbar-title` element (title + optional `🔒` badge) as the first child of `.topbar-inner`, before the brand, with a `·` separator. Render compact `View on GitHub` / `Raw JSONL` links in `.topbar-actions` before the Share button. These extra elements are present in the DOM at all times but visually hidden and removed from tab order until stuck.
- **`viewer.css`** — Styles and transitions for `.topbar-title`, its separator, and the compact links, keyed off the `.viewer-header.is-stuck` ancestor selector.
- **`TraceHeader.module.css`** — Collapse `.header` (meta row + large title) under a `:global(.viewer-header.is-stuck)` ancestor selector, since the class lives outside the CSS module.

## Edge cases

- **Long titles** — compact title truncates with `text-overflow: ellipsis` and a `max-width` clamp so it never crowds out the breadcrumb.
- **Tab order** — the hidden duplicated links/title get `visibility: hidden` (delayed in the transition) so they are not focusable while collapsed.
- **Reduced motion** — `@media (prefers-reduced-motion: reduce)` removes or shortens the transitions.

## Testing

Extend `webapp/frontend/src/tests/routes/TraceView.test.tsx`:

- The compact title is absent/hidden in the initial (not-stuck) render.
- When the `is-stuck` class is applied to `.viewer-header`, the compact title and compact GitHub/Raw links are present/visible, and `TraceHeader`'s meta row is collapsed.

(`IntersectionObserver` is mocked in the test environment; tests assert on the `is-stuck` class effect rather than real scroll.)

## Out of scope

- The reverted Compact mode toggle — this feature is purely scroll-driven and independent of it.
- Any change to the un-scrolled two-bar layout.
