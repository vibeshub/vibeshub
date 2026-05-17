# Custom trace renderer

_Replace the third-party `claude-code-log` HTML pipeline with an in-app React trace viewer._

## Why

Today's trace page iframes a static HTML document produced server-side by `claude-code-log`. Every UX want — deep-linking into a turn, in-app navigation, theming consistent with the rest of the SPA, search, filtering, interactive timeline — runs aground because the rendered HTML is opaque and lives in a sandboxed iframe. Post-processing the package's output isn't a sustainable path. A user mocked up a clean Linear/Notion-ish viewer in Claude Design (handoff bundle attached); this spec ports that design into the SPA.

## Scope

**In scope**
- New React-based trace viewer at the existing `/{owner}/{repo}/pull/{number}/{shortId}` route.
- Client-side JSONL parser (`parseJsonl` + `buildSession`) producing a normalized `{meta, stream}` view-model.
- Sticky in-viewer topbar, hero (title + first prompt + 4 stat cells + metadata line + tools chips + interactive activity timeline), single-column thread, collapsible tool cards (Bash, Read/Glob/Grep, Write/Edit/MultiEdit, AskUserQuestion, Task*, Agent, Skill, generic JSON), assistant text with light markdown, thinking blocks (toggle), system events (toggle), PR card.
- Light/dark theme persisted to `localStorage`; sun/moon toggle in the topbar. Amber accent fixed (no accent picker, no Tweaks panel).
- Self-hosted Geist + Geist Mono via `@fontsource-variable/*`.
- Backend: delete `claude-code-log` Python dep, the `/api/traces/:short_id/rendered` route, the `app/render/` package, the `Render` ORM model, the storage-shim test, the `renderer_version` setting. Add an alembic migration to drop the `renders` table.
- Frontend: delete `TraceFrame.tsx`, `RawFallback.tsx`, `RenderFailedError`, `fetchRenderedHtml` from `api.ts`.

**Out of scope**
- Search / filter / find-in-trace.
- Cross-trace navigation, prev/next trace.
- Accent picker, floating Tweaks panel (in design but answer to Q2 said skip).
- Backend AI-title generation (today's `aiTitle` is already in JSONL records from the plugin; we just read it).
- Pre-computing a server-side JSON view-model — parsing stays in the browser.

## Architecture

```
GET /api/traces/:short_id       → TraceSummary (PR title, repo, byte_size, …)
GET /api/traces/:short_id/raw   → JSONL bytes (text/plain)

TraceView
├── TraceHeader            (existing, PR chrome — kept above the viewer)
└── TraceViewer            (NEW)
    ├── ViewerTopbar       sticky · brand · share/copy · theme toggle
    ├── Hero
    │   ├── HeroEyebrow    SESSION · short id · date
    │   ├── title          meta.aiTitle (fallback "Untitled session")
    │   ├── first prompt   meta.firstPrompt (in a soft-bg card)
    │   ├── MetaStrip      4 cells: Duration · Turns · Tool calls · Tokens
    │   ├── MetaLine       model · branch · cwd · cli · permissions
    │   ├── ToolsChips     per-tool count chips with category dot
    │   └── Timeline       SVG stacked-bar activity strip, hover + click-to-scroll
    ├── ThreadControls     Show reasoning · Show system events
    ├── Thread             walks stream, dispatches to:
    │   ├── UserPrompt
    │   ├── AssistantText  (with Markdown sub-renderer)
    │   ├── ThinkingBlock  (gated by Show reasoning)
    │   ├── ToolCard       collapsible, dispatches body by tool name
    │   ├── SystemEventRow (gated by Show system events)
    │   └── PrCard         rendered when a pr-link event is in the stream
    └── Footer             session id · viewer credit
```

`TraceViewer` receives `session: Session` (parsed) as a prop. It owns no fetch state. `TraceView` fetches the JSONL string and the trace summary, parses, and passes both down. Errors at fetch surface via the existing `<ErrorState>`. Empty stream surfaces an empty-state card linking to `/raw`.

## Data model

```ts
type ToolCategory = "bash" | "read" | "write" | "agent" | "skill" | "ask" | "task" | "other";

interface SessionMeta {
  sessionId: string | null;
  aiTitle: string | null;
  firstPrompt: string | null;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  version: string | null;          // CLI version
  permissionMode: string | null;
  startedAt: string | null;        // ISO timestamp
  endedAt: string | null;          // ISO timestamp
  prLink: { number: number; url: string; repo: string; at: string } | null;
  tokens: { input: number; cacheCreate: number; cacheRead: number; output: number };
  assistantThinkMs: number;        // sum of system turn_duration records
  toolCounts: Record<string, number>;
  toolCallCount: number;
  userPromptCount: number;
  assistantTextCount: number;
}

type StreamEvent =
  | { kind: "user_prompt"; text: string; ts: string; uuid: string }
  | { kind: "assistant_text"; text: string; ts: string; msgId: string; uuid: string }
  | { kind: "thinking"; text: string; ts: string; msgId: string; uuid: string }
  | { kind: "tool_use"; name: string; input: unknown; id: string; ts: string; msgId: string; uuid: string; result: ToolResult | null }
  | { kind: "system_text"; text: string; ts: string; uuid: string; source: "user_text" }
  | { kind: "attachment"; subtype: string; payload: AttachmentPayload; ts: string; uuid: string }
  | { kind: "system_event"; subtype: string; durationMs?: number; messageCount?: number; ts: string; uuid: string }
  | { kind: "file_snapshot"; payload: unknown; ts: string; uuid: string }
  | { kind: "pr_link"; payload: PrLinkRecord; ts: string };

interface Session { meta: SessionMeta; stream: StreamEvent[] }
```

## Parser

`parseJsonl(text) → records[]`
- Split on `\n`, `JSON.parse` each non-empty line, swallow parse errors.

`buildSession(records) → Session`
- **Pass 1:** collect meta (`sessionId`, `aiTitle`, `permissionMode`, `cwd`, `gitBranch`, `version`, `model`, `prLink`, first user-string prompt, `startedAt`/`endedAt` from min/max `timestamp`); sum tokens from `r.message.usage`; sum `r.durationMs` for `system/turn_duration` records; index `tool_result` blocks by `tool_use_id`.
- **Pass 2:** emit normalized stream in file order. For `assistant` records, the message's `content[]` is repeated across multiple lines (one line per appended block), each line carrying the FULL content array. Emit only the **last** block per line, keyed by `${msgId}|${blockIdx}|${block.type}` against a `Set` to prevent re-emission. Attach matching `tool_result` to each `tool_use` event.

Counts and totals (`toolCounts`, `toolCallCount`, `userPromptCount`, `assistantTextCount`) computed from the resulting stream and attached to `meta`.

This logic is a port of the design's `parser.js`. Pinning behavior with a test that feeds the design's `sample-session.jsonl` and asserts:
- meta keys are populated (sessionId, aiTitle, model, branch, cwd, startedAt/endedAt set, prLink present).
- `stream.length`, ordered counts per kind, no duplicate `${msgId}|${blockIdx}` keys.
- `tool_use` events have their `result` attached.

## Tool categorization

`TOOL_META` map (`tools.ts`) — same as design. `toolCat(name)` defaults to `"other"`. Drives both the dot color in the topbar chips/tool-card heads and the timeline stack colors. Adding a new tool means appending to `TOOL_META`; no other code changes.

## Tool body renderers

| Tool                                | Body                                                                 |
|-------------------------------------|----------------------------------------------------------------------|
| `Bash`                              | description (if any) · command in `$ ` terminal block · stdout/stderr block (red if `isError`) |
| `Read` / `Glob` / `Grep`            | file card (icon + shortened path + line count) · preview block       |
| `Write` / `Edit` / `MultiEdit`      | file card · content block                                            |
| `AskUserQuestion`                   | question header + title + option cards; the option matching the next user prompt is highlighted with a "picked" marker |
| `TaskCreate`                        | pending-status row + subject + optional description                  |
| `TaskUpdate`                        | status icon + `Task {id} → status` row                               |
| `Agent`                             | subagent card with type/model + description + collapsible dispatch prompt |
| `Skill`                             | skill name in file-card chrome                                       |
| (anything else)                     | `GenericBody` — pretty-printed JSON for input and result             |

Header summary (always visible) comes from `format.toolSummary(name, input, cwd)` — e.g. for `Bash` it's the command; for file tools it's the shortened path; for `AskUserQuestion` it's the first question text + "(+N more)".

## Theming

- `tokens.css` replaced with the design's tokens (warm oklch neutrals, amber accent, per-category tool dot colors, Geist font vars).
- `globals.css` updated to use the new tokens.
- `viewer.css` added as a global stylesheet, scoped at the root by the `.vibeshub-viewer` class.
- `useTheme()` hook persists `light | dark | system` to `localStorage["vibeshub.theme"]`, resolves to `light` or `dark`, and sets `document.documentElement.dataset.theme` accordingly. Honors `prefers-color-scheme` when `system`.
- Amber accent is fixed; no accent picker, no floating Tweaks panel. The two in-thread toggles (`Show reasoning`, `Show system events`) are component-local — not persisted.

## Timeline

`Hero/Timeline.tsx` — SVG strip, 70px tall, `viewBox="0 0 NB 70"` with `NB = 140` buckets across the wall-clock range (`endedAt - startedAt`). Each bucket draws a stacked bar of tool-use counts by category in a fixed order (`read, bash, write, task, agent, skill, ask, other`). User-prompt timestamps overlay as vertical tick + dot. Hover crosshair shows the moment under the cursor (mapped through bucket → timestamp → time-of-day in the ticks row). Click finds the nearest stream event with a `uuid` (`tool_use | user_prompt | assistant_text`) and `scrollIntoView({behavior: "smooth", block: "center"})` against `[data-uuid="…"]`. Every renderable event sets `data-uuid={event.uuid}` on its root element so the click target exists.

## Markdown subset

`format.renderMarkdownish(text)` splits on `\n\n` and recognizes `# / ## / ###`, hyphen/asterisk bullet lists, paragraphs. `format.inlineFormat(text)` recognizes `**bold**`, `*em*`, `` `code` `` with a single regex pass. No links, no images, no tables, no fenced code blocks. Matches the design's intent: enough to make assistant prose scannable without becoming a markdown engine.

## Backend changes

| File | Change |
|------|--------|
| `webapp/backend/pyproject.toml` | Drop `claude-code-log` dependency |
| `webapp/backend/app/settings.py` | Drop `renderer_version` field |
| `webapp/backend/app/main.py` | Drop `render` router import + include |
| `webapp/backend/app/api/render.py` | DELETE |
| `webapp/backend/app/render/` | DELETE (`__init__.py`, `claude_code_log.py`) |
| `webapp/backend/app/storage/models.py` | DELETE `Render` model + `Trace.renders` relationship |
| `webapp/backend/alembic/versions/<id>_drop_renders_table.py` | NEW — `op.drop_table("renders")`; downgrade recreates table matching current schema |
| `webapp/backend/tests/test_render.py` | DELETE |

The `/api/traces/:short_id/raw` endpoint already exists and is the only one the new viewer needs.

## Frontend changes

| File | Change |
|------|--------|
| `webapp/frontend/package.json` | Add `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` |
| `webapp/frontend/src/api.ts` | Drop `fetchRenderedHtml`, `RenderFailedError` |
| `webapp/frontend/src/routes/TraceView.tsx` | Rewrite: fetch raw → `parseJsonl` → `buildSession` → `<TraceViewer session=…/>` |
| `webapp/frontend/src/components/TraceFrame.{tsx,module.css}` | DELETE |
| `webapp/frontend/src/components/RawFallback.{tsx,module.css}` | DELETE |
| `webapp/frontend/src/components/TraceHeader.tsx` | Unchanged (kept above viewer) |
| `webapp/frontend/src/styles/tokens.css` | Replace with design's tokens (warm neutrals, amber accent, tool dot colors, Geist vars, light + `[data-theme="dark"]`) |
| `webapp/frontend/src/styles/globals.css` | Update to use new tokens + import Geist via `@fontsource-variable/*` |
| `webapp/frontend/src/styles/viewer.css` | NEW — port of design's `viewer.css` (single global sheet, root-scoped by `.vibeshub-viewer`) |
| `webapp/frontend/src/components/trace/*` | NEW — see module layout above |
| `webapp/frontend/src/tests/trace/parser.test.ts` | NEW |
| `webapp/frontend/src/tests/trace/format.test.ts` | NEW |
| `webapp/frontend/src/tests/routes/TraceView.test.tsx` | NEW |
| `webapp/frontend/e2e/trace-view.spec.ts` | Update assertions for new DOM (hero + tool card + timeline) |

The design's `sample-session.jsonl` is committed as a test fixture at `webapp/frontend/src/tests/fixtures/sample-session.jsonl`.

## Error and empty states

- JSONL fetch fails → `<ErrorState message={…}/>`.
- Parser yields zero events → empty-state card: "This trace has no parseable events." with a `View raw JSONL ↗` link to `/api/traces/:id/raw`.
- No `render_failed` branch exists in the new pipeline — every parseable line is best-effort and bad lines are silently skipped (matches design's `parseJsonl`).

## Testing

- **Vitest:** `parser.test.ts` (sample-session ingest + dedup invariants), `format.test.ts` (duration/token formatters, markdown, tool summary), `TraceView.test.tsx` (mock `/raw`, render, assert hero title + at least one tool card; with `MemoryRouter`).
- **Playwright:** existing `e2e/trace-view.spec.ts` updated to fixture-serve the sample JSONL through the dev server and assert hero appears, click a tool head to expand, click the timeline.
- **Backend:** delete `test_render.py`. Add `tests/test_migrations.py` smoke test that runs `alembic upgrade head` then `alembic downgrade -1` against in-memory SQLite (only if the project doesn't already have one — quick check before adding).

## Non-goals / explicitly punted

- No virtualization of the thread. Sample session is ~700KB JSONL → a few hundred events; current React renders this in <50ms. If a future trace blows up, add windowing then.
- No client-side syntax highlighting in Bash output or file previews. Plain monospace, matches the design.
- No URL fragments / `#turn-N` deep links yet. The timeline already does click-to-scroll; a URL hash is a follow-up.
- No accent picker. Single amber accent, light + dark only.

## Rollout

Single PR, single migration. The `/api/traces/:id/rendered` endpoint disappears in the same change as the frontend code that called it, so there's no compatibility window. Existing rows in `renders` are pure cache — losing them costs nothing.
