# Merge the signed-in homepage into the user profile page

**Date:** 2026-05-22
**Status:** Approved — ready for implementation planning

## Goal

The signed-in workspace homepage (`/home`, rendered by the `Dashboard`
component) and the public user profile page (`/:owner`, rendered by
`UserPage`) become a single page. The profile page is the canonical
destination; `/home` redirects to it.

Before `Dashboard` is deleted, its worthwhile pieces are folded into
`UserPage` so nothing valuable is lost.

## Current state

- `/home` → `Home.tsx` → renders `<Dashboard user={user} />` for signed-in
  visitors; redirects anonymous visitors to `/`.
- `/:owner` → `UserPage.tsx` → public profile for any user. Structure:
  `entity-head` → GitHub stat strip → Traces/Repositories tabs → split
  (trace list + "Top repositories" aside) → footer.
- `Dashboard` has features `UserPage` lacks: a greeting hero + ID card, a
  GitHub contribution heatmap, a vibeshub stat strip, a zero-trace
  onboarding card, a "Capturing more" tip card, a private-repo access
  nudge, and a copy-profile-link button.

## Routing & file changes

- **`Home.tsx`** becomes a pure redirect. While auth is resolving it
  renders the existing empty `page-shell`. Once resolved:
  signed-in → `<Navigate to={/${user.login}} replace />`;
  anonymous → `<Navigate to="/" replace />`.
- The `/home` route stays in `App.tsx`. Existing links to `/home` (e.g.
  `AuthWidget`'s "Go to your workspace" button, and the private-repo
  nudge's `next=%2Fhome`) keep working via the redirect.
- **`Dashboard.tsx` is deleted** after its pieces are ported.
- **`Dashboard.module.css`**: the classes still used by the ported pieces
  (contribution heatmap, onboarding card, owner cards) move into a new
  **`UserPage.module.css`**; unused classes (greeting hero, ID card, etc.)
  are dropped. `Dashboard.module.css` is deleted with `Dashboard.tsx`.
  `UserPage` continues to use the global `pages.css` classes for its
  existing structure and gains this module only for the ported pieces.
- The Dashboard ID card and the hero lede paragraph are **not** ported —
  `UserPage`'s existing `entity-head` (avatar, `@owner`, "active … ago")
  already covers identity. The Dashboard's **personalized greeting** *is*
  kept, as an owner-only element (see Owner affordances below).

## Owner detection

`UserPage` reads auth via `useAuth()` and computes:

```ts
const isOwner =
  !!user && user.login.toLowerCase() === owner.toLowerCase();
```

`isOwner` gates every owner-only affordance below. Public visitors and
anonymous visitors see the same page minus those affordances.

## New UserPage layout

*(owner-only greeting line)* → `entity-head` → merged stat strip →
GitHub contribution heatmap → Traces/Repositories tabs → split (trace
list + aside) → footer.

### 1. Merged stat strip

The current GitHub-derived stat strip (Public repos / Stars / Followers /
Top languages) is replaced by one 4-cell `.stat-strip`:

| Cell | Value | Source |
|---|---|---|
| Traces | `stats.trace_count` | `fetchUserOverview` |
| Repositories | `stats.repo_count` | `fetchUserOverview` |
| Messages | `compactCount(stats.message_count)` | `fetchUserOverview` |
| Followers | `compactCount(ghUser.followers)` | `fetchGithubUser` |

`fetchGithubUser` is still called (Followers needs it). When the GitHub
fetch fails or is still loading, the Followers cell shows the existing
fallback treatment ("—" / "Loading…"); the other three cells render from
`fetchUserOverview` independently.

### 2. GitHub contribution heatmap

`GithubActivitySection`, `buildHeatmap`, `ActivityLoading`, `Figure`, and
the heatmap helpers/constants (`WEEKS`, `WEEKDAY_LABELS`, `MONTHS`,
`isoDay`, `HeatCell`, `HeatModel`) are ported from `Dashboard.tsx` into
`UserPage.tsx` (or a small co-located module). Data comes from
`fetchGithubContributions(owner)`.

The heatmap shows on **every** profile — it is public GitHub data, not
owner-only. It sits between the stat strip and the tabs. While the
contributions fetch is in flight it renders `ActivityLoading`; on error it
renders nothing (matching current Dashboard behavior).

### 3. Onboarding install card

The `Onboarding` component (install snippet + 3 steps) and its
`INSTALL_COPY` constant are ported in. It renders **only when `isOwner`
and `stats.trace_count === 0`**, in place of the Traces-tab "No traces
yet." empty state. A non-owner viewing an empty profile still sees the
plain "No traces yet." empty state.

### 4. Owner affordances (`isOwner` only)

- **Personalized greeting** — the `greetingFor(new Date())` helper is
  ported in. When `isOwner`, a greeting line renders directly above the
  `entity-head`: e.g. "Good morning, Bhavya." The first name is derived
  from the auth user the same way the Dashboard did it
  (`user.name?.trim().split(/\s+/)[0] || user.login`). This is a single
  line of text, not the full Dashboard hero — the `entity-head` below it
  still carries the avatar and `@handle`. Non-owners never see it.
- **Copy-profile-link button** — the `CopyLinkButton` component, placed in
  the `entity-actions` area next to "View on GitHub ↗".
- **"Capturing more" tip card** — ported into the aside, below the
  existing "Top repositories" side-card.
- **Private-repo nudge card** — ported into the aside, rendered only when
  `!user.has_private_access`. Its login link keeps `next=%2Fhome` (the
  redirect resolves to the owner's profile).

## Trace visibility & GitHub privacy

No change to visibility behavior — it is already correct and stays that
way. The `/api/users/{login}` endpoint (`get_user_overview`) filters every
trace through `_filter_visible`: a private-repo trace is included only if
`_can_view_repo` confirms, via GitHub's real access check using the
*viewer's* token, that this specific visitor can read the repo. Stat
counts and the repo breakdown are aggregated from the filtered rows, so
private repos never leak — not even as numbers. `UserPage` already calls
this endpoint, so a visitor seeing someone else's profile correctly sees
only the public traces plus any private traces they personally have
GitHub access to. The merge inherits this unchanged.

## Error & loading behavior

- `fetchUserOverview` failure → existing `ErrorState` (unchanged).
- `fetchUserOverview` pending → existing `LoadingState` (unchanged).
- `fetchGithubUser` failure/pending → only the Followers stat cell shows a
  fallback; the rest of the page renders.
- `fetchGithubContributions` failure → heatmap section omitted; pending →
  `ActivityLoading` placeholder.

## Testing

- Add `tests/routes/UserPage.test.tsx`:
  - Owner view: personalized greeting line present, copy-link button
    present, tip card present, private-repo nudge present when
    `has_private_access` is false, onboarding card shown when
    `trace_count === 0`.
  - Visitor view: none of the owner affordances present (no greeting);
    empty profile
    shows plain "No traces yet." instead of the onboarding card.
  - Merged stat strip renders Traces / Repositories / Messages /
    Followers.
- `Home`: verify it redirects a signed-in user to `/{login}` and an
  anonymous user to `/`. Add coverage if none exists.
- Existing `tests/routes/PrTracesList.test.tsx` and
  `tests/routes/TraceView.test.tsx` are unaffected.

## Out of scope

- No changes to the public Landing page (`/`).
- No backend/API changes — all four endpoints
  (`fetchUserOverview`, `fetchGithubUser`, `fetchGithubContributions`,
  `fetchMe`) already exist.
- No redesign of the trace list, tabs, or "Top repositories" aside beyond
  adding the owner-only cards.
