# Standalone Trace Uploads — Phase 3: Web Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Phase 2's backend in the web UI: render standalone traces at a canonical `/t/<short_id>` route, let a signed-in user upload a trace from the browser (with an optional PR/repo association via the picker endpoints), and give a trace owner in-page controls to toggle privacy, link/unlink a repo or PR, and delete the trace.

**Architecture:** The frontend is a React 19 + react-router-dom 7 SPA (Vite, CSS Modules, vitest + Testing Library). Phase 2 made `Trace.repo_full_name` / `pr_number` / `pr_url` nullable and added `/api/uploads`, `PATCH /api/traces/{short_id}`, and the `/api/github/my-repos` + `/api/github/repo-prs` pickers; Phase 2 also added session-cookie auth (owner-only) to the existing `DELETE /api/traces/{short_id}` so it can be called from the browser. Phase 3 (1) widens the `TraceSummary` TypeScript type and every component that reads those fields to tolerate `null`, (2) adds a canonical `/t/:shortId` route that `TraceView` already half-supports (it reads `shortId` from params), (3) builds an `/upload` page gated behind auth that POSTs multipart to `/api/uploads`, with a `RepoPrPicker` component driving the two picker endpoints, and (4) adds an owner-only `TraceManageMenu` to `TraceView` that calls `PATCH` / `DELETE`. All network calls go through `src/api.ts`; auth state comes from `useAuth()`.

**Tech Stack:** TypeScript, React 19, react-router-dom 7, Vite 8, CSS Modules, vitest 3 + @testing-library/react 16 (`jsdom`). Tests mock `global.fetch` and `../auth/AuthContext` per the existing `tests/routes/UserPage.test.tsx` pattern.

---

## File Structure

### Created

| Path | Responsibility |
|------|----------------|
| `webapp/frontend/src/routes/UploadPage.tsx` | `/upload` route — auth-gated browser upload form (transcript file + optional subagents zip + optional PR/repo link + privacy). |
| `webapp/frontend/src/routes/UploadPage.module.css` | Styles for the upload page. |
| `webapp/frontend/src/components/RepoPrPicker.tsx` | Reusable picker: search owned/collaborated repos, then PRs in the chosen repo; emits `{ pr_url }` or `{ repo_full_name }` or nothing. |
| `webapp/frontend/src/components/RepoPrPicker.module.css` | Styles for the picker. |
| `webapp/frontend/src/components/TraceManageMenu.tsx` | Owner-only menu on `TraceView`: toggle privacy, link/unlink repo or PR, delete. |
| `webapp/frontend/src/components/TraceManageMenu.module.css` | Styles for the manage menu. |
| `webapp/frontend/src/tests/routes/UploadPage.test.tsx` | Tests for the upload page (auth gate, validation, success). |
| `webapp/frontend/src/tests/components/RepoPrPicker.test.tsx` | Tests for the picker component. |
| `webapp/frontend/src/tests/components/TraceManageMenu.test.tsx` | Tests for the manage menu. |

### Modified

| Path | Responsibility |
|------|----------------|
| `webapp/frontend/src/types.ts` | `TraceSummary.repo_full_name` / `pr_number` / `pr_url` become `… | null`; add `GithubPickerRepo`, `GithubPickerPr`, `UploadResult`, `TracePatch` types. |
| `webapp/frontend/src/api.ts` | Add `uploadTrace`, `patchTrace`, `deleteTrace`, `fetchMyRepos`, `fetchRepoPrs`. |
| `webapp/frontend/src/App.tsx` | Add `<Route path="t/:shortId" element={<TraceView />} />` and `<Route path="upload" element={<UploadPage />} />`. |
| `webapp/frontend/src/routes/TraceView.tsx` | Tolerate a null `repo_full_name` (no `.split("/")` crash); render `TraceManageMenu` for the owner. |
| `webapp/frontend/src/components/TraceHeader.tsx` | Render standalone traces (no PR title / repo crumb / "View on GitHub"); fall back to a generic title. |
| `webapp/frontend/src/components/TraceListRow.tsx` | Tolerate null repo/PR fields in the list row. |
| `webapp/frontend/src/tests/routes/TraceView.test.tsx` | Add standalone-trace and owner-menu cases; keep PR cases green. |

> **Phase 2 (already delivered, do not redefine):** `/api/uploads` (multipart `transcript` + optional `subagents` + `is_private` / `pr_url` / `repo_full_name` form fields), `PATCH /api/traces/{short_id}` (body `{ is_private?, pr_url?, repo_full_name? }`, owner-only, returns the updated `TraceSummary`), `DELETE /api/traces/{short_id}` (204, owner-only — Phase 2 added session-cookie auth alongside the existing bearer-token path so the browser can call it), `GET /api/github/my-repos?q=` (`{ repos: [{full_name,name,private}] }`), `GET /api/github/repo-prs?repo=&q=` (`{ prs: [{number,title,html_url}] }`). Tasks below **call** these.

---

## Conventions for every task

- **Tests first.** Each task writes a failing test, runs it to see it fail, implements, and re-runs to green. The repo runs vitest via `npm test` (one-shot) from `webapp/frontend`.
- **Run a single file** while iterating: `cd webapp/frontend && npx vitest run src/tests/<path>`.
- **Mocking pattern** (copy from `src/tests/routes/UserPage.test.tsx`): `vi.mock("../../auth/AuthContext", () => ({ useAuth: vi.fn() }))`, then `vi.spyOn(global, "fetch").mockImplementation(...)` routing by URL substring. Reset with `beforeEach(() => vi.restoreAllMocks())`.
- **Type-check** is part of the build (`tsc -b`). After the type widening in Task 1, every consumer must compile — Task 2 fixes the fallout.
- **Commit** at the end of each task with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

---

## Task 1: Widen `TraceSummary` and add the new API types

Phase 2 made repo/PR nullable on the backend. The frontend `TraceSummary` still types them as non-null `string` / `number`, so any standalone trace would lie to the type checker. Widen the type and add the picker/upload/patch types in one place.

**Files:**
- `webapp/frontend/src/types.ts`

1. - [ ] **Step 1: Widen `TraceSummary`.** In `webapp/frontend/src/types.ts`, change the three fields of `TraceSummary` (currently lines 13-15):
   ```ts
     repo_full_name: string | null;
     pr_number: number | null;
     pr_url: string | null;
   ```

2. - [ ] **Step 2: Add the Phase-3 types.** Append to `webapp/frontend/src/types.ts`:
   ```ts
   /** A repo entry from GET /api/github/my-repos. */
   export interface GithubPickerRepo {
     full_name: string;
     name: string;
     private: boolean;
   }

   /** A PR entry from GET /api/github/repo-prs. */
   export interface GithubPickerPr {
     number: number;
     title: string;
     html_url: string;
   }

   /** The JSON body returned by POST /api/uploads. */
   export interface UploadResult {
     trace_id: string;
     short_id: string;
     trace_url: string;
     created: boolean;
   }

   /**
    * The body of PATCH /api/traces/{short_id}. Every field is optional;
    * omitting a field leaves it unchanged, while sending `null` clears the
    * association (matching the backend's model_fields_set semantics).
    */
   export interface TracePatch {
     is_private?: boolean;
     pr_url?: string | null;
     repo_full_name?: string | null;
   }
   ```

3. - [ ] **Step 3: Confirm the file still parses.** Run:
   ```
   cd webapp/frontend && npx tsc -b --noEmit 2>&1 | head -20
   ```
   Expected: errors **only** in files that read `trace.repo_full_name` / `pr_number` / `pr_url` as non-null (e.g. `TraceHeader.tsx`, `TraceView.tsx`, `TraceListRow.tsx`). Those are fixed in Task 2 — note the list of failing files for Task 2.

4. - [ ] **Step 4: Commit.** Run:
   ```
   cd webapp/frontend && git add src/types.ts && git commit -m "Widen TraceSummary repo/PR fields to nullable; add picker/upload types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

## Task 2: Render standalone traces (null-safe `TraceHeader`, `TraceView`, `TraceListRow`)

A standalone trace has `repo_full_name === null`, so `repo_full_name.split("/")` crashes. Make the three rendering paths null-safe and give standalone traces a sensible header.

**Files:**
- `webapp/frontend/src/components/TraceHeader.tsx`
- `webapp/frontend/src/routes/TraceView.tsx`
- `webapp/frontend/src/components/TraceListRow.tsx`
- `webapp/frontend/src/tests/routes/TraceView.test.tsx`

1. - [ ] **Step 1: Write a failing standalone-trace test.** In `webapp/frontend/src/tests/routes/TraceView.test.tsx`, add a test that renders `TraceView` for a trace whose `repo_full_name` / `pr_number` / `pr_url` are all `null`. Reuse the file's existing fetch-mock helper; the trace summary payload sets those three fields to `null` and `pr_title` to `null`. Assert the component renders without throwing and that no "View on GitHub" link is present:
   ```tsx
   it("renders a standalone trace with no repo or PR", async () => {
     // ...mock /api/traces/<sid> -> standalone summary, /raw -> jsonl...
     renderTraceViewAt("/t/abc1234567");
     await waitFor(() =>
       expect(screen.queryByText(/Loading trace/i)).not.toBeInTheDocument(),
     );
     expect(
       screen.queryByRole("link", { name: /View on GitHub/i }),
     ).not.toBeInTheDocument();
   });
   ```
   Add a `renderTraceViewAt(path)` helper if the file lacks one — mount `<TraceView />` under `<MemoryRouter initialEntries={[path]}>` with both `t/:shortId` and the PR route declared, mirroring `UserPage.test.tsx`'s `renderUserPage`.

2. - [ ] **Step 2: Run the test, see it fail.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx
   ```
   Expected: the new test fails — a `TypeError: Cannot read properties of null (reading 'split')` thrown from `TraceView` / `TraceHeader`.

3. - [ ] **Step 3: Make `TraceView` null-safe.** In `webapp/frontend/src/routes/TraceView.tsx`, replace the `<TraceViewer>` `repoOwner` / `repoName` props so they tolerate a null `repo_full_name`:
   ```tsx
   const repoParts = head.trace.repo_full_name?.split("/") ?? [];
   // ...
   <TraceViewer
     trace={head.trace}
     session={session}
     shortId={head.trace.short_id}
     rawHref={`/api/traces/${head.trace.short_id}/raw`}
     repoOwner={repoParts[0]}
     repoName={repoParts[1]}
   />
   ```
   If `TraceViewer`'s `repoOwner` / `repoName` props are typed `string`, widen them to `string | undefined` in `TraceViewer.tsx` and guard any use (e.g. a repo crumb link renders only when both are set).

4. - [ ] **Step 4: Make `TraceHeader` null-safe.** In `webapp/frontend/src/components/TraceHeader.tsx`, replace the `const [repoOwner, repoName] = trace.repo_full_name.split("/");` line and the JSX so a standalone trace renders cleanly:
   - Title: `trace.pr_title ?? (trace.pr_number != null ? `PR #${trace.pr_number}` : `Trace ${trace.short_id}`)`.
   - "View on GitHub ↗" link: render only when `trace.pr_url` is set.
   - Repo crumb (`<Link to={`/${repoOwner}`}>` … `#${trace.pr_number}`): render the whole `<span>` only when `trace.repo_full_name` is set; compute `[repoOwner, repoName]` inside that branch. When `pr_number` is null, drop the trailing `#…`.
   - Keep the private badge, platform, message-count, size, date, and "uploaded by" meta unchanged — those fields are always present.

5. - [ ] **Step 5: Make `TraceListRow` null-safe.** In `webapp/frontend/src/components/TraceListRow.tsx`, audit every read of `repo_full_name` / `pr_number` / `pr_url`. Where the row links to a PR or repo, render that link only when the field is set; otherwise fall back to a plain label or the `/t/<short_id>` link. The row's primary link should target `/t/${trace.short_id}` for any trace (it works for PR-associated traces too), so a standalone trace is always navigable.

6. - [ ] **Step 6: Run the test, see it pass.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/routes/TraceView.test.tsx
   ```
   Expected: all `TraceView` tests pass, including the new standalone case.

7. - [ ] **Step 7: Confirm the type check is clean.** Run:
   ```
   cd webapp/frontend && npx tsc -b --noEmit 2>&1 | head -20
   ```
   Expected: no errors — every consumer now tolerates the nullable fields.

8. - [ ] **Step 8: Run the full frontend suite.** Run:
   ```
   cd webapp/frontend && npm test
   ```
   Expected: all tests pass (the existing PR-trace tests still render the repo crumb and GitHub link because their fixtures keep those fields populated).

9. - [ ] **Step 9: Commit.** Run:
   ```
   cd webapp/frontend && git add src/components/TraceHeader.tsx src/routes/TraceView.tsx src/components/TraceListRow.tsx src/components/trace/TraceViewer.tsx src/tests/routes/TraceView.test.tsx && git commit -m "Render standalone traces with no repo or PR association

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```
   (Drop `TraceViewer.tsx` from the `git add` if Step 3 did not need to touch it.)

---

## Task 3: Canonical `/t/:shortId` route

Phase 2's endpoints return `trace_url` as `<base>/t/<short_id>`. The SPA must serve that path; `TraceView` already reads `shortId` from `useParams`, so this is a routing-only change.

**Files:**
- `webapp/frontend/src/App.tsx`

1. - [ ] **Step 1: Confirm `TraceView` uses the `shortId` param.** Run:
   ```
   cd webapp/frontend && grep -n "useParams" src/routes/TraceView.tsx
   ```
   Expected: `const { shortId } = useParams<{ shortId: string }>();` — the route only needs to supply a `:shortId` segment.

2. - [ ] **Step 2: Add the route.** In `webapp/frontend/src/App.tsx`, add inside `<Routes>`, **before** the existing `:owner/:repo/pull/:number` routes (so the literal `t` segment is matched first and never shadowed by the `:owner` catch-all):
   ```tsx
   <Route path="t/:shortId" element={<TraceView />} />
   ```

3. - [ ] **Step 3: Smoke-test routing.** Run:
   ```
   cd webapp/frontend && npx tsc -b --noEmit 2>&1 | head -5
   ```
   Expected: no errors. (A render test for the route is added in Task 2's standalone test, which already mounts `t/:shortId`; no separate test is needed here.)

4. - [ ] **Step 4: Commit.** Run:
   ```
   cd webapp/frontend && git add src/App.tsx && git commit -m "Add canonical /t/:shortId route for traces

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

## Task 4: API client functions

Add the five frontend wrappers for Phase 2's endpoints. They follow the existing `src/api.ts` style: `fetch` with `credentials: "same-origin"`, `ApiError` on non-OK.

**Files:**
- `webapp/frontend/src/api.ts`
- `webapp/frontend/src/tests/api.test.ts`

1. - [ ] **Step 1: Write failing tests for the new client functions.** Append to `webapp/frontend/src/tests/api.test.ts` (match the file's existing fetch-mock style). Cover:
   - `uploadTrace` builds a `FormData` with `transcript` (and `subagents` / `pr_url` / `repo_full_name` / `is_private` when supplied), POSTs to `/api/uploads`, returns the parsed `UploadResult`.
   - `patchTrace` PATCHes `/api/traces/<sid>` with a JSON body and returns the updated `TraceSummary`.
   - `deleteTrace` DELETEs `/api/traces/<sid>` and resolves on 204.
   - `fetchMyRepos` GETs `/api/github/my-repos?q=<q>` and returns the `repos` array.
   - `fetchRepoPrs` GETs `/api/github/repo-prs?repo=<repo>&q=<q>` and returns the `prs` array.
   - One error case: a non-OK response throws `ApiError` with the right status.
   ```ts
   it("uploadTrace posts multipart form data", async () => {
     let captured: { url: string; init: RequestInit } | null = null;
     vi.spyOn(global, "fetch").mockImplementation((url, init) => {
       captured = { url: String(url), init: init as RequestInit };
       return Promise.resolve(
         new Response(
           JSON.stringify({
             trace_id: "t1", short_id: "abc", trace_url: "/t/abc",
             created: true,
           }),
           { status: 201, headers: { "content-type": "application/json" } },
         ),
       );
     });
     const transcript = new File(['{"type":"user"}\n'], "chat.jsonl");
     const result = await uploadTrace({ transcript, isPrivate: false });
     expect(captured!.url).toBe("/api/uploads");
     expect(captured!.init.method).toBe("POST");
     expect(captured!.init.body).toBeInstanceOf(FormData);
     expect(result.short_id).toBe("abc");
   });
   ```

2. - [ ] **Step 2: Run the tests, see them fail.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/api.test.ts
   ```
   Expected: the new tests fail to import — `uploadTrace` / `patchTrace` / `deleteTrace` / `fetchMyRepos` / `fetchRepoPrs` are not exported.

3. - [ ] **Step 3: Implement the client functions.** Append to `webapp/frontend/src/api.ts` (add the new types to the top-of-file `import type { … }` block):
   ```ts
   export interface UploadTraceArgs {
     transcript: File;
     subagents?: File | null;
     isPrivate?: boolean;
     prUrl?: string | null;
     repoFullName?: string | null;
   }

   export async function uploadTrace(
     args: UploadTraceArgs,
   ): Promise<UploadResult> {
     const form = new FormData();
     form.append("transcript", args.transcript);
     if (args.subagents) form.append("subagents", args.subagents);
     form.append("is_private", String(args.isPrivate ?? false));
     if (args.prUrl) form.append("pr_url", args.prUrl);
     if (args.repoFullName) form.append("repo_full_name", args.repoFullName);
     const r = await fetch("/api/uploads", {
       method: "POST",
       body: form,
       credentials: "same-origin",
     });
     return jsonOrThrow<UploadResult>(r);
   }

   export async function patchTrace(
     shortId: string,
     patch: TracePatch,
   ): Promise<TraceSummary> {
     const r = await fetch(`/api/traces/${shortId}`, {
       method: "PATCH",
       headers: { "content-type": "application/json" },
       body: JSON.stringify(patch),
       credentials: "same-origin",
     });
     return jsonOrThrow<TraceSummary>(r);
   }

   export async function deleteTrace(shortId: string): Promise<void> {
     const r = await fetch(`/api/traces/${shortId}`, {
       method: "DELETE",
       credentials: "same-origin",
     });
     if (r.status !== 204) {
       throw new ApiError(r.status, await r.text());
     }
   }

   export async function fetchMyRepos(
     query = "",
   ): Promise<GithubPickerRepo[]> {
     const qs = query ? `?q=${encodeURIComponent(query)}` : "";
     const r = await fetch(`/api/github/my-repos${qs}`, {
       credentials: "same-origin",
     });
     const data = await jsonOrThrow<{ repos: GithubPickerRepo[] }>(r);
     return data.repos;
   }

   export async function fetchRepoPrs(
     repoFullName: string,
     query = "",
   ): Promise<GithubPickerPr[]> {
     const params = new URLSearchParams({ repo: repoFullName });
     if (query) params.set("q", query);
     const r = await fetch(`/api/github/repo-prs?${params.toString()}`, {
       credentials: "same-origin",
     });
     const data = await jsonOrThrow<{ prs: GithubPickerPr[] }>(r);
     return data.prs;
   }
   ```

4. - [ ] **Step 4: Run the tests, see them pass.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/api.test.ts
   ```
   Expected: all `api.test.ts` tests pass.

5. - [ ] **Step 5: Commit.** Run:
   ```
   cd webapp/frontend && git add src/api.ts src/tests/api.test.ts && git commit -m "Add uploadTrace, patchTrace, deleteTrace, and GitHub picker API clients

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

## Task 5: `RepoPrPicker` component

A reusable two-stage picker: the user searches their repos (`fetchMyRepos`), picks one, then optionally searches PRs in that repo (`fetchRepoPrs`) and picks one. It is "controlled by callback": it reports the current selection up to its parent as a discriminated value. Used by the upload page (Task 6) and the manage menu (Task 7).

**Files:**
- `webapp/frontend/src/components/RepoPrPicker.tsx`
- `webapp/frontend/src/components/RepoPrPicker.module.css`
- `webapp/frontend/src/tests/components/RepoPrPicker.test.tsx`

1. - [ ] **Step 1: Decide the component contract.** `RepoPrPicker` props:
   ```ts
   /** The selection the picker reports to its parent. */
   export type PickerSelection =
     | { kind: "none" }
     | { kind: "repo"; repoFullName: string }
     | { kind: "pr"; prUrl: string; repoFullName: string };

   interface RepoPrPickerProps {
     value: PickerSelection;
     onChange: (selection: PickerSelection) => void;
     /** Disable all inputs (e.g. while a parent request is in flight). */
     disabled?: boolean;
   }
   ```
   Behavior: with no repo chosen, the selection is `{ kind: "none" }` (a standalone upload). Choosing a repo makes it `{ kind: "repo", ... }`. Choosing a PR within that repo makes it `{ kind: "pr", ... }`. A "clear" affordance returns to `{ kind: "none" }`.

2. - [ ] **Step 2: Write failing tests.** Create `webapp/frontend/src/tests/components/RepoPrPicker.test.tsx`. Mock `../../api`'s `fetchMyRepos` / `fetchRepoPrs` with `vi.mock`. Cover:
   - Renders a repo search input; typing triggers `fetchMyRepos` and lists results.
   - Clicking a repo result calls `onChange` with `{ kind: "repo", repoFullName }` and reveals the PR search.
   - Clicking a PR result calls `onChange` with `{ kind: "pr", prUrl, repoFullName }`.
   - A "clear" button calls `onChange` with `{ kind: "none" }`.
   - When `disabled`, the inputs are disabled.
   ```tsx
   it("lists repos and reports a repo selection", async () => {
     (fetchMyRepos as Mock).mockResolvedValue([
       { full_name: "alice/repo", name: "repo", private: false },
     ]);
     const onChange = vi.fn();
     render(<RepoPrPicker value={{ kind: "none" }} onChange={onChange} />);
     fireEvent.change(screen.getByPlaceholderText(/search.*repo/i), {
       target: { value: "rep" },
     });
     await waitFor(() => screen.getByText("alice/repo"));
     fireEvent.click(screen.getByText("alice/repo"));
     expect(onChange).toHaveBeenCalledWith({
       kind: "repo", repoFullName: "alice/repo",
     });
   });
   ```

3. - [ ] **Step 3: Run the tests, see them fail.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/components/RepoPrPicker.test.tsx
   ```
   Expected: the file fails to resolve `../../components/RepoPrPicker`.

4. - [ ] **Step 4: Implement `RepoPrPicker`.** Create `webapp/frontend/src/components/RepoPrPicker.tsx`. Implementation notes:
   - Local state: the repo search string, repo results, the chosen repo, the PR search string, PR results, a loading flag, and an error string.
   - Debounce the repo / PR search inputs (~250 ms via a `setTimeout` cleared in a `useEffect` cleanup) so a keystroke does not fire a request per character.
   - On a repo search, call `fetchMyRepos(query)`; render up to ~10 results as clickable rows showing `full_name` and a 🔒 marker when `private`.
   - On repo selection, set the chosen repo, clear PR state, and `onChange({ kind: "repo", repoFullName })`.
   - On a PR search, call `fetchRepoPrs(repoFullName, query)`; render results as `#<number> <title>` rows. Selecting a PR calls `onChange({ kind: "pr", prUrl: pr.html_url, repoFullName })`.
   - A "Clear" / "Make standalone" button resets all local state and `onChange({ kind: "none" })`.
   - Catch `ApiError` from the API calls and show its message inline; never throw out of an event handler.
   - Mirror `value` into local state on mount so the parent can pre-seed a selection (used by Task 7 when editing an existing trace).

5. - [ ] **Step 5: Add styles.** Create `webapp/frontend/src/components/RepoPrPicker.module.css` with a search input, a result list, selected-chip, and error styles consistent with the existing CSS-Module look (see `routes/UserPage.module.css` for spacing/color conventions).

6. - [ ] **Step 6: Run the tests, see them pass.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/components/RepoPrPicker.test.tsx
   ```
   Expected: all `RepoPrPicker` tests pass.

7. - [ ] **Step 7: Commit.** Run:
   ```
   cd webapp/frontend && git add src/components/RepoPrPicker.tsx src/components/RepoPrPicker.module.css src/tests/components/RepoPrPicker.test.tsx && git commit -m "Add RepoPrPicker component for repo/PR association selection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

## Task 6: `/upload` page

An auth-gated page that uploads a transcript from the browser. Anonymous visitors see a sign-in prompt; signed-in users get a form with the transcript file input, an optional subagents `.zip` input, the `RepoPrPicker`, and a privacy toggle. On success it navigates to `/t/<short_id>`.

**Files:**
- `webapp/frontend/src/routes/UploadPage.tsx`
- `webapp/frontend/src/routes/UploadPage.module.css`
- `webapp/frontend/src/App.tsx`
- `webapp/frontend/src/tests/routes/UploadPage.test.tsx`

1. - [ ] **Step 1: Write failing tests.** Create `webapp/frontend/src/tests/routes/UploadPage.test.tsx`, mocking `../../auth/AuthContext` and `../../api` (per the `UserPage.test.tsx` pattern). Cover:
   - **Anonymous:** `useAuth` returns `{ user: null, loading: false }` → the page shows a sign-in prompt and **no** upload form.
   - **Signed in, no file:** the Submit button is disabled until a `transcript` file is chosen.
   - **Signed in, success:** select a file, submit → `uploadTrace` is called with the file and `isPrivate: false`; on resolve the page navigates to `/t/<short_id>` (assert via a `<Routes>` harness that renders a sentinel element at `t/:shortId`, or by asserting the success URL text).
   - **Standalone notice:** when no repo/PR is picked, the form shows copy that the trace will be public.
   - **Error:** `uploadTrace` rejects with `ApiError` → the page shows the error message and stays on the form.
   ```tsx
   it("uploads a standalone trace and navigates to it", async () => {
     mockUseAuth.mockReturnValue(signedInAuth);
     (uploadTrace as Mock).mockResolvedValue({
       trace_id: "t1", short_id: "abc1234567",
       trace_url: "/t/abc1234567", created: true,
     });
     renderUploadPage();
     const file = new File(['{"type":"user"}\n'], "chat.jsonl");
     fireEvent.change(screen.getByLabelText(/transcript/i), {
       target: { files: [file] },
     });
     fireEvent.click(screen.getByRole("button", { name: /upload/i }));
     await waitFor(() =>
       expect(screen.getByText(/trace view/i)).toBeInTheDocument(),
     );
   });
   ```

2. - [ ] **Step 2: Run the tests, see them fail.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/routes/UploadPage.test.tsx
   ```
   Expected: the file fails to resolve `../../routes/UploadPage`.

3. - [ ] **Step 3: Implement `UploadPage`.** Create `webapp/frontend/src/routes/UploadPage.tsx`. Implementation notes:
   - Read `const { user, loading } = useAuth()`. While `loading`, render `<LoadingState />`. When `user` is null, render a sign-in prompt (reuse `PageTopbar`'s sign-in affordance or `AuthWidget`, plus a short explainer); render no form.
   - Form state: `transcript: File | null`, `subagents: File | null`, `selection: PickerSelection` (default `{ kind: "none" }`), `isPrivate: boolean` (default `false`), and a `status` discriminated union (`idle` / `uploading` / `error`).
   - The `transcript` `<input type="file">` must have an associated `<label>` (so the test's `getByLabelText(/transcript/i)` works); accept `.jsonl`. The `subagents` input accepts `.zip` and is optional.
   - Render `<RepoPrPicker value={selection} onChange={setSelection} disabled={status==='uploading'} />`.
   - **Privacy rule:** when `selection.kind !== "none"` the trace's privacy mirrors GitHub (the backend ignores the form `is_private` for repo-associated uploads). In that case disable the privacy toggle and show an explanatory note. When `selection.kind === "none"`, the toggle is active and the page shows that the standalone trace is public unless marked private.
   - Submit is disabled unless `transcript` is set and `status !== "uploading"`.
   - On submit: set `status: "uploading"`, call
     ```ts
     uploadTrace({
       transcript,
       subagents,
       isPrivate: selection.kind === "none" ? isPrivate : false,
       prUrl: selection.kind === "pr" ? selection.prUrl : null,
       repoFullName:
         selection.kind === "repo"
           ? selection.repoFullName
           : selection.kind === "pr"
             ? selection.repoFullName
             : null,
     })
     ```
     On resolve, `navigate(`/t/${result.short_id}`)` (`useNavigate` from react-router-dom). On `ApiError`, set `status: "error"` with the message and keep the form.

4. - [ ] **Step 4: Add styles.** Create `webapp/frontend/src/routes/UploadPage.module.css` consistent with the other route modules (a centered column, labelled fields, a primary submit button, error text).

5. - [ ] **Step 5: Register the route.** In `webapp/frontend/src/App.tsx`, add inside `<Routes>` before the `:owner/:repo/...` routes:
   ```tsx
   <Route path="upload" element={<UploadPage />} />
   ```
   and add `import { UploadPage } from "./routes/UploadPage";` to the imports.

6. - [ ] **Step 6: Run the tests, see them pass.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/routes/UploadPage.test.tsx
   ```
   Expected: all `UploadPage` tests pass.

7. - [ ] **Step 7: Commit.** Run:
   ```
   cd webapp/frontend && git add src/routes/UploadPage.tsx src/routes/UploadPage.module.css src/App.tsx src/tests/routes/UploadPage.test.tsx && git commit -m "Add /upload page for browser-based trace uploads

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

## Task 7: `TraceManageMenu` — owner-only privacy / link / delete controls

When the signed-in user owns the trace, `TraceView` renders a manage menu: a privacy toggle, an "Edit association" affordance backed by `RepoPrPicker`, and a delete action with confirmation. Edits go through `patchTrace`; delete goes through `deleteTrace`.

**Files:**
- `webapp/frontend/src/components/TraceManageMenu.tsx`
- `webapp/frontend/src/components/TraceManageMenu.module.css`
- `webapp/frontend/src/routes/TraceView.tsx`
- `webapp/frontend/src/tests/components/TraceManageMenu.test.tsx`

1. - [ ] **Step 1: Decide the component contract.** `TraceManageMenu` props:
   ```ts
   interface TraceManageMenuProps {
     trace: TraceSummary;
     /** Called with the updated summary after a successful PATCH. */
     onUpdated: (trace: TraceSummary) => void;
     /** Called after a successful DELETE so the parent can navigate away. */
     onDeleted: () => void;
   }
   ```

2. - [ ] **Step 2: Write failing tests.** Create `webapp/frontend/src/tests/components/TraceManageMenu.test.tsx`, mocking `../../api`'s `patchTrace` / `deleteTrace`. Cover:
   - Renders a privacy toggle reflecting `trace.is_private`.
   - Toggling privacy on a **standalone** trace calls `patchTrace(shortId, { is_private: true })` and forwards the result to `onUpdated`.
   - For a **repo-associated** trace, the privacy toggle is disabled with a note that privacy mirrors GitHub.
   - The delete action requires a confirmation step before it calls `deleteTrace`; after a resolved `deleteTrace` it calls `onDeleted`.
   - Linking a repo via the embedded `RepoPrPicker` calls `patchTrace` with `{ repo_full_name }`; clearing the association calls `patchTrace` with `{ repo_full_name: null }`.
   ```tsx
   it("toggles privacy on a standalone trace", async () => {
     (patchTrace as Mock).mockResolvedValue({
       ...standaloneTrace, is_private: true,
     });
     const onUpdated = vi.fn();
     render(
       <TraceManageMenu
         trace={standaloneTrace}
         onUpdated={onUpdated}
         onDeleted={vi.fn()}
       />,
     );
     fireEvent.click(screen.getByRole("button", { name: /make private/i }));
     await waitFor(() =>
       expect(patchTrace).toHaveBeenCalledWith(standaloneTrace.short_id, {
         is_private: true,
       }),
     );
     expect(onUpdated).toHaveBeenCalled();
   });
   ```

3. - [ ] **Step 3: Run the tests, see them fail.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/components/TraceManageMenu.test.tsx
   ```
   Expected: the file fails to resolve `../../components/TraceManageMenu`.

4. - [ ] **Step 4: Implement `TraceManageMenu`.** Create `webapp/frontend/src/components/TraceManageMenu.tsx`. Implementation notes:
   - **Privacy:** a toggle/button. Disabled (with a note) when `trace.repo_full_name !== null`, because the backend ignores `is_private` for repo-associated traces. When standalone, clicking calls `patchTrace(trace.short_id, { is_private: !trace.is_private })` and forwards the result to `onUpdated`.
   - **Association:** an "Edit association" disclosure that mounts `RepoPrPicker`, pre-seeded from the trace's current state — `{ kind: "pr", prUrl: trace.pr_url, repoFullName: trace.repo_full_name }` when `pr_url` is set, else `{ kind: "repo", repoFullName: trace.repo_full_name }` when `repo_full_name` is set, else `{ kind: "none" }`. An "Apply" action maps the `PickerSelection` to a `TracePatch` (`none` → `{ repo_full_name: null, pr_url: null }`; `repo` → `{ repo_full_name }`; `pr` → `{ pr_url }`) and calls `patchTrace`.
   - **Delete:** a destructive button that first switches to an inline "Are you sure? [Confirm] [Cancel]" state; Confirm calls `deleteTrace(trace.short_id)` then `onDeleted()`.
   - A `busy` flag disables all controls during any in-flight request; `ApiError` messages render inline and never throw.

5. - [ ] **Step 5: Add styles.** Create `webapp/frontend/src/components/TraceManageMenu.module.css` — a compact panel/menu with a primary toggle, a disclosure section, and a clearly destructive delete button, consistent with the existing CSS-Module styling.

6. - [ ] **Step 6: Wire it into `TraceView`.** In `webapp/frontend/src/routes/TraceView.tsx`:
   - Import `useAuth` and `useNavigate`, plus `TraceManageMenu`.
   - The owner check is `auth.user?.login === head.trace.owner_login`. Render `<TraceManageMenu>` only for the owner (the header area is a sensible spot — pass it to `TraceViewer` or render it alongside, whichever the layout allows without disrupting the existing viewer).
   - `onUpdated` updates the `head` state (`setHead({ kind: "ready", trace: updated })`) so the page reflects the new privacy/association immediately.
   - `onDeleted` navigates away — `navigate("/" + head.trace.owner_login)` (the owner's profile) is a reasonable destination.

7. - [ ] **Step 7: Add a `TraceView` owner-menu test.** In `webapp/frontend/src/tests/routes/TraceView.test.tsx`, add cases asserting (a) when `useAuth` returns the trace owner, the manage controls render, and (b) when it returns a different user or `null`, they do not. Use the existing `vi.mock("../../auth/AuthContext", ...)` hook; if the file does not yet mock `AuthContext`, add the mock now.

8. - [ ] **Step 8: Run the affected suites, see them pass.** Run:
   ```
   cd webapp/frontend && npx vitest run src/tests/components/TraceManageMenu.test.tsx src/tests/routes/TraceView.test.tsx
   ```
   Expected: all tests pass.

9. - [ ] **Step 9: Commit.** Run:
   ```
   cd webapp/frontend && git add src/components/TraceManageMenu.tsx src/components/TraceManageMenu.module.css src/routes/TraceView.tsx src/tests/components/TraceManageMenu.test.tsx src/tests/routes/TraceView.test.tsx && git commit -m "Add owner-only trace management menu (privacy, association, delete)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

## Task 8: Discoverability — link to `/upload`

Give signed-in users a way to reach the new upload page from the chrome. A small "Upload" link in `PageTopbar` (visible only when signed in) is enough.

**Files:**
- `webapp/frontend/src/components/PageTopbar.tsx`
- `webapp/frontend/src/tests/` (extend an existing PageTopbar/Home test or add one)

1. - [ ] **Step 1: Inspect `PageTopbar`.** Run:
   ```
   cd webapp/frontend && cat src/components/PageTopbar.tsx
   ```
   Identify where it renders auth-dependent chrome (it consumes `useAuth()` or receives the user as a prop).

2. - [ ] **Step 2: Write a failing test.** Add a test (in the existing `PageTopbar` test file, or `Home.test.tsx` if `PageTopbar` has none) asserting: when signed in, a link with text `/upload/i` pointing at `/upload` is present; when signed out, it is absent.

3. - [ ] **Step 3: Run the test, see it fail.** Run the relevant test file with `npx vitest run`.

4. - [ ] **Step 4: Add the link.** In `webapp/frontend/src/components/PageTopbar.tsx`, render a `<Link to="/upload">Upload</Link>` (styled to match the existing topbar links) only when there is a signed-in user. Do not change anything for anonymous visitors.

5. - [ ] **Step 5: Run the test, see it pass.** Run the test file again — expected: pass.

6. - [ ] **Step 6: Commit.** Run:
   ```
   cd webapp/frontend && git add src/components/PageTopbar.tsx src/tests/ && git commit -m "Add an Upload link to the topbar for signed-in users

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
   ```

---

## Task 9: Full-suite verification

**Files:** none (verification only).

1. - [ ] **Step 1: Run the entire frontend test suite.** Run:
   ```
   cd webapp/frontend && npm test
   ```
   Expected: all tests pass, zero unhandled rejections. New files exercised: `UploadPage.test.tsx`, `RepoPrPicker.test.tsx`, `TraceManageMenu.test.tsx`, plus the extended `TraceView.test.tsx` / `api.test.ts`.

2. - [ ] **Step 2: Type-check and build.** Run:
   ```
   cd webapp/frontend && npm run build
   ```
   Expected: `tsc -b` reports no errors and Vite produces a clean `dist/`.

3. - [ ] **Step 3: Confirm the new routes resolve.** Run:
   ```
   cd webapp/frontend && grep -n "t/:shortId\|\"upload\"\|path=\"upload\"" src/App.tsx
   ```
   Expected: both the `t/:shortId` and `upload` routes appear in `App.tsx`.

4. - [ ] **Step 4: Confirm the working tree is clean.** Run:
   ```
   cd /Users/bhavya/git/vibeshub && git status --short && git log --oneline -9
   ```
   Expected: a clean tree; the last ~8 commits are this phase's.

---

## Notes for the implementer

- **Phase-2 dependency:** every API call in Task 4 assumes Phase 2 shipped `/api/uploads`, `PATCH /api/traces/{short_id}`, the `/api/github/my-repos` + `/api/github/repo-prs` pickers, and the session-cookie auth path on `DELETE /api/traces/{short_id}`, and that Phase 1 made the `Trace` repo/PR columns nullable. If `npm test` for Task 4's `api.test.ts` passes but a manual `curl` against the running backend 404s — or a browser/cookie `DELETE` returns 401 — Phase 2 is incomplete — stop and resolve that first.
- **`DELETE /api/traces/{short_id}` is cookie-authenticated as of Phase 2.** The endpoint in `webapp/backend/app/api/traces.py` (soft-delete + best-effort blob cleanup, owner-only, 204) previously accepted only a bearer token and rejected browser/session-cookie requests with 401. Phase 2 includes a task that adds session-cookie auth (owner-only) to this endpoint alongside the existing bearer-token path. Task 7's `deleteTrace` issues `fetch(..., { method: "DELETE", credentials: "same-origin" })` and relies on the session cookie — this works because Phase 2 delivered the cookie-auth path. No additional backend change is needed in Phase 3, but Phase 3 depends on that Phase 2 task having shipped.
- **Privacy is GitHub-mirrored for associated traces.** The backend ignores the `is_private` form field / patch field whenever a trace has a `repo_full_name`. The UI must reflect this — the privacy toggle is disabled (with a note) for repo/PR-associated traces in both `UploadPage` (Task 6) and `TraceManageMenu` (Task 7). Do not let the UI imply a privacy choice the backend will silently discard.
- **`/t/<short_id>` is the canonical trace URL.** Phase 2 returns it from `/api/ingest` and `/api/uploads`; Phase 4's CLI prints it. Task 3 makes the SPA serve it, and Task 2 points `TraceListRow`'s primary link at it so PR-associated and standalone traces share one navigable URL. The legacy `:owner/:repo/pull/:number/:shortId` route stays for back-compat with old links.
- **`model_fields_set` semantics carry to the client.** `patchTrace` sends only the keys present on the `TracePatch` object — omitting a key leaves the field unchanged, sending `null` clears it. `TraceManageMenu`'s "Apply" must therefore send `{ repo_full_name: null, pr_url: null }` (not `{}`) to revert a trace to standalone.
- **Anonymous users never see upload UI.** `UploadPage` and the topbar link are gated on `useAuth().user`. An anonymous visitor who navigates directly to `/upload` gets the sign-in prompt, not a broken form.
- **Test isolation:** every new test file follows the `tests/routes/UserPage.test.tsx` template — `vi.mock` for `AuthContext` and `../../api`, `beforeEach(() => vi.restoreAllMocks())`, and fetch/API mocks routed by URL or resolved value. Do not hit the network in tests.
