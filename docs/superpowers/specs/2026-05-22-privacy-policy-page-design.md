# Privacy Policy Page — Design

**Date:** 2026-05-22
**Status:** Approved

## Summary

Add a dedicated `/privacy` page to the vibeshub SPA. The page presents a
plain-language but comprehensive privacy policy, with content derived from
what the codebase actually collects and stores. The landing page keeps its
existing `#privacy` teaser section as a summary and links out to the full
policy.

## Goals

- Give vibeshub a real, accurate privacy policy reachable at a stable URL.
- Describe only what the app genuinely does — collection, redaction, storage,
  sharing, retention, deletion — with no aspirational or boilerplate claims.
- Match the existing SPA's routing, theming, and page-shell conventions.

## Non-Goals

- Formal legalese, defined-terms sections, or jurisdiction-specific
  (GDPR/CCPA) clauses. The policy is plain-language.
- A separate terms-of-service page.
- Any change to data collection, redaction, or backend behavior. This is a
  documentation/UI change only.

## Approach

A new `Privacy.tsx` SPA route component, styled with a new
`Privacy.module.css` and the existing CSS tokens — mirroring how `Landing.tsx`
and the other route components are built. No new dependencies (rejected a
markdown-rendered alternative for that reason; rejected static HTML because it
breaks SPA routing and theming).

## Routing & Linking

- Add `<Route path="privacy" element={<Privacy />} />` to
  `webapp/frontend/src/App.tsx`.
- `Privacy.tsx` uses the `page-shell` layout with `PageTopbar`
  (breadcrumb: a single `Privacy` crumb, `current: true`) and a footer
  consistent with the other pages.
- Landing page changes (`webapp/frontend/src/routes/Landing.tsx`):
  - The hero's "Privacy & redaction" button (`href="#privacy"`) and the
    footer "Privacy" link change to a router `<Link to="/privacy">`.
  - The top-nav `#privacy` anchor stays an in-page jump to the teaser
    section.
  - The `#privacy` teaser section itself stays as a summary; add a
    "Read the full privacy policy" link to `/privacy` within it.

## Page Content

Plain-language, comprehensive. Sections, in order:

1. **Intro & scope** — what vibeshub is; effective date 2026-05-22.
2. **What we collect**
   - GitHub account data captured at sign-in: GitHub ID, login, display
     name, avatar URL, email.
   - The GitHub OAuth access token, stored encrypted (Fernet ciphertext);
     the `repo` scope is requested only when the user opts into private
     repositories.
   - A session cookie: an opaque session ID with an expiry.
   - Uploaded traces: the Claude Code transcript (JSONL), plus repository
     full name, PR number/title/URL, platform, plugin version, session ID,
     byte size, message count, and redaction counts.
3. **Redaction** — two-pass scrubbing: client-side before upload and
   server-side before storage. Patterns: Anthropic / OpenAI / GitHub keys,
   AWS access keys, JWTs, `*_KEY` / `_TOKEN` / `_SECRET` / `_PASSWORD`
   environment assignments, and a high-entropy fallback. Honest caveat:
   redaction is best-effort — users should review a trace before sharing.
4. **How we use it** — authenticate the user, render traces, and gate
   private-repo traces by checking the viewer's GitHub repo access.
5. **Visibility & sharing** — a trace inherits its repo's visibility; a
   trace from a public repo is visible to anyone with the link.
6. **Third parties** — GitHub (OAuth and API); hosting infrastructure
   (Azure Container Apps, Postgres, Blob Storage). No sale of data, no
   advertising trackers.
7. **Retention & deletion** — traces can be deleted at any time via
   `/share-pr delete`; deletion is honored. Sessions expire.
8. **Your rights & contact** — access and deletion requests go to
   **bhavya@vibeshub.ai**.
9. **Changes to this policy** — note that the policy may be updated and the
   effective date will change.

## Testing

Add `webapp/frontend/src/tests/routes/Privacy.test.tsx`, mirroring the
existing route tests (e.g. `Home.test.tsx`). It asserts:

- the page renders without error,
- key section headings are present,
- the contact email `bhavya@vibeshub.ai` appears.

## Files Touched

- `webapp/frontend/src/routes/Privacy.tsx` — new
- `webapp/frontend/src/routes/Privacy.module.css` — new
- `webapp/frontend/src/App.tsx` — add route
- `webapp/frontend/src/routes/Landing.tsx` — repoint Privacy links
- `webapp/frontend/src/tests/routes/Privacy.test.tsx` — new
