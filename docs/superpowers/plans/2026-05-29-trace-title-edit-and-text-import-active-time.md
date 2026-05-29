# Editable Trace Title + Active Time for Text Imports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trace owner set/edit a persistent title from the viewer (all traces), and stop showing a misleading "0s" Active Time on text-import traces by labeling it "not available for text imports".

**Architecture:** Add a nullable `title` column to the `Trace` table; expose it via `TraceSummary` and accept it in the owner-gated `PATCH /api/traces/{short_id}`. In the frontend, a small isolated `HeroTitle` component renders `trace.title || meta.aiTitle || "Untitled session"` and, for owners, an inline edit affordance that calls `patchTrace`. Active Time is a pure presentational change in `Outcome.tsx` gated on `meta.sourceFormat === "terminal"`.

**Tech Stack:** Backend: FastAPI + SQLAlchemy (async) + Alembic, pytest (`../../env/bin/pytest` from `webapp/backend`). Frontend: React + TypeScript + Vitest + Testing Library.

**Working directory:** repo root `/Users/bhavya/git/vibeshub`. Backend paths are under `webapp/backend`, frontend under `webapp/frontend`. Branch `feat/trace-title-edit` is already checked out with the design spec committed.

**Conventions:**
- No em-dashes in user-facing copy (use commas, periods, or parentheses).
- The Python virtualenv lives at the **repo root** (`/Users/bhavya/git/vibeshub/env`), not under `webapp/backend`. From `webapp/backend` the tools are therefore `../../env/bin/pytest`, `../../env/bin/alembic`, `../../env/bin/python` (this matches `webapp/backend/README.md`, which runs `../../env/bin/pytest -v`). Do NOT use `webapp/backend/.venv` — it has `alembic`/`python` but no test deps.
- Run frontend tests with `npm test` (= `vitest run`) from `webapp/frontend`; typecheck with `npx tsc -b`.

---

## File Structure

**Backend (`webapp/backend`):**
- Modify `app/storage/models.py` — add `title` column to `Trace`.
- Create `alembic/versions/c1a2b3d4e5f6_add_title_to_traces.py` — migration adding the column.
- Modify `app/api/schemas.py` — add `title` to `TraceSummary`.
- Modify `app/api/traces.py` — add `title` to `TracePatch`, populate in `_to_summary`, handle in `patch_trace`.
- Modify `tests/test_traces_patch.py` — add title PATCH tests.

**Frontend (`webapp/frontend`):**
- Modify `src/types.ts` — add `title` to `TraceSummary` and `TracePatch`.
- Create `src/components/trace/HeroTitle.tsx` — the title display + inline owner editor.
- Modify `src/components/trace/Hero.tsx` — accept `canEdit`/`onTraceUpdated`, render `HeroTitle` instead of the `<h1>`.
- Modify `src/components/trace/TraceViewer.tsx` — thread `canEditTitle`/`onTraceUpdated` to `Hero`.
- Modify `src/routes/TraceView.tsx` — pass `canEditTitle={isOwner}` and `onTraceUpdated`.
- Modify `src/components/trace/Outcome.tsx` — Active Time cell for terminal traces.
- Modify `src/styles/viewer.css` — styles for the inline title editor.
- Create `src/tests/trace/HeroTitle.test.tsx` — unit tests for the editor.
- Create `src/tests/trace/outcome.test.tsx` — Active Time rendering test.

---

## Task 1: Add `title` column to the Trace model

**Files:**
- Modify: `webapp/backend/app/storage/models.py` (the `Trace` class, near the `source_format` column around line 71)

- [ ] **Step 1: Add the column**

In `app/storage/models.py`, immediately after the `source_format` mapped_column block (the one ending around line 73), add:

```python
    # Owner-supplied display title. NULL means "fall back to the trace's
    # derived title" (the client shows the AI title or "Untitled session").
    # Settable only by the owner via PATCH /api/traces/{short_id}.
    title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
```

(`Text` and `Optional` are already imported in this file.)

- [ ] **Step 2: Typecheck the import compiles**

Run: `cd webapp/backend && ../../env/bin/python -c "from app.storage.models import Trace; print('title' in Trace.__table__.columns)"`
Expected: prints `True`

- [ ] **Step 3: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/backend/app/storage/models.py
git commit -m "Add nullable title column to Trace model"
```

---

## Task 2: Alembic migration for the `title` column

**Files:**
- Create: `webapp/backend/alembic/versions/c1a2b3d4e5f6_add_title_to_traces.py`

The current Alembic head is `b8d3f1a02c4e` (add source_format). This migration chains off it, mirroring the dialect-split pattern used by `b8d3f1a02c4e_add_source_format_to_traces.py`.

- [ ] **Step 1: Write the migration file**

Create `webapp/backend/alembic/versions/c1a2b3d4e5f6_add_title_to_traces.py` with exactly:

```python
"""add title to traces

Revision ID: c1a2b3d4e5f6
Revises: b8d3f1a02c4e
Create Date: 2026-05-29 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1a2b3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "b8d3f1a02c4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the nullable `title` column to `traces`.

    An owner-supplied display title; NULL for all existing rows (the client
    falls back to the derived/AI title). On Postgres this is a plain
    ALTER TABLE; on SQLite we recreate the table via batch mode, matching the
    existing migrations in this project.
    """
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.add_column(
            "traces",
            sa.Column("title", sa.Text(), nullable=True),
        )
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.add_column(sa.Column("title", sa.Text(), nullable=True))


def downgrade() -> None:
    """Reverse of `upgrade`: drop the `title` column."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_column("traces", "title")
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.drop_column("title")
```

- [ ] **Step 2: Verify the migration chain has a single head**

Run: `cd webapp/backend && ../../env/bin/alembic heads`
Expected: a single head, `c1a2b3d4e5f6 (head)`.

- [ ] **Step 3: Verify upgrade runs on a scratch SQLite DB**

Run:
```bash
cd webapp/backend && VIBESHUB_DATABASE_URL="sqlite:///$PWD/_scratch_title.db" \
  ../../env/bin/alembic upgrade head && \
  ../../env/bin/python -c "import sqlite3; c=sqlite3.connect('_scratch_title.db'); \
print('title' in [r[1] for r in c.execute('PRAGMA table_info(traces)')])" && \
  rm -f _scratch_title.db
```
Expected: ends by printing `True`.

Note: if `alembic` is invoked differently in this repo (check `webapp/backend/alembic.ini` / README), use that invocation. The migration file content is unchanged regardless.

- [ ] **Step 4: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/backend/alembic/versions/c1a2b3d4e5f6_add_title_to_traces.py
git commit -m "Migration: add title column to traces"
```

---

## Task 3: Expose `title` in TraceSummary (backend schema)

**Files:**
- Modify: `webapp/backend/app/api/schemas.py` (the `TraceSummary` class)
- Modify: `webapp/backend/app/api/traces.py` (`_to_summary`, around line 165-181)

- [ ] **Step 1: Add `title` to the schema**

In `app/api/schemas.py`, inside `class TraceSummary`, add a field right after `pr_title: str | None` (around line 26):

```python
    title: str | None = None
```

- [ ] **Step 2: Populate it in `_to_summary`**

In `app/api/traces.py`, in `_to_summary`, add `title=t.title,` to the `TraceSummary(...)` constructor (e.g. right after `pr_title=t.pr_title,`):

```python
        pr_title=t.pr_title,
        title=t.title,
```

- [ ] **Step 3: Sanity import check**

Run: `cd webapp/backend && ../../env/bin/python -c "from app.api.schemas import TraceSummary; print('title' in TraceSummary.model_fields)"`
Expected: prints `True`

- [ ] **Step 4: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/backend/app/api/schemas.py webapp/backend/app/api/traces.py
git commit -m "Expose trace title in TraceSummary"
```

---

## Task 4: Accept `title` in PATCH /api/traces/{short_id}

**Files:**
- Modify: `webapp/backend/app/api/traces.py` (`TracePatch` class around line 37; `patch_trace` around line 482-554)
- Test: `webapp/backend/tests/test_traces_patch.py`

- [ ] **Step 1: Write the failing tests**

Append to `webapp/backend/tests/test_traces_patch.py`:

```python
@pytest.mark.asyncio
async def test_patch_sets_title(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.patch(f"/api/traces/{sid}", json={"title": "  My session  "},
                     cookies=cookies)
    assert r.status_code == 200
    assert r.json()["title"] == "My session"

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == sid)
        )).scalar_one()
    assert trace.title == "My session"


@pytest.mark.asyncio
async def test_patch_empty_title_resets_to_null(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="alice")
    client.patch(f"/api/traces/{sid}", json={"title": "Something"},
                 cookies=cookies)
    r = client.patch(f"/api/traces/{sid}", json={"title": "   "},
                     cookies=cookies)
    assert r.status_code == 200
    assert r.json()["title"] is None

    SessionLocal = client.app.state.session_maker
    async with SessionLocal() as session:
        trace = (await session.execute(
            select(Trace).where(Trace.short_id == sid)
        )).scalar_one()
    assert trace.title is None


@pytest.mark.asyncio
async def test_patch_title_too_long_rejected(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="alice")
    r = client.patch(f"/api/traces/{sid}", json={"title": "x" * 201},
                     cookies=cookies)
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_patch_title_non_owner_forbidden(client):
    sid = await _seed_standalone_trace(client, owner_login="alice")
    cookies, _ = await authed_cookies(client, login="bob", github_id=200)
    r = client.patch(f"/api/traces/{sid}", json={"title": "hijack"},
                     cookies=cookies)
    assert r.status_code == 403
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_traces_patch.py -k "title" -v`
Expected: the title tests FAIL (e.g. `test_patch_sets_title` returns `title` = None or KeyError), since `TracePatch` has no `title` field yet and `patch_trace` ignores it.

- [ ] **Step 3: Add `title` to `TracePatch`**

In `app/api/traces.py`, in `class TracePatch`, add a field:

```python
class TracePatch(BaseModel):
    """All fields optional; pydantic's model_fields_set distinguishes an
    absent field from one explicitly set to null."""
    is_private: bool | None = None
    pr_url: str | None = None
    repo_full_name: str | None = None
    title: str | None = None
```

- [ ] **Step 4: Handle `title` in `patch_trace`**

In `app/api/traces.py`, inside `patch_trace`, after the `is_private` handling block (right before `await session.commit()` near line 552), add:

```python
    # Title is owner-editable on any trace. Trim, cap at 200 chars, and treat
    # an empty/whitespace string as "reset to the derived title" (NULL).
    if "title" in fields:
        new_title = patch.title
        if new_title is not None:
            new_title = new_title.strip()
            if len(new_title) > 200:
                raise HTTPException(status_code=400, detail="title_too_long")
            if new_title == "":
                new_title = None
        trace.title = new_title
```

`fields` is already defined earlier in the function as `patch.model_fields_set`.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd webapp/backend && ../../env/bin/pytest tests/test_traces_patch.py -v`
Expected: all tests PASS (the four new ones plus the pre-existing ones).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/backend/app/api/traces.py webapp/backend/tests/test_traces_patch.py
git commit -m "Accept owner title edits in PATCH /api/traces"
```

---

## Task 5: Frontend types for title

**Files:**
- Modify: `webapp/frontend/src/types.ts` (`TraceSummary` around line 9; `TracePatch` around line 170)

- [ ] **Step 1: Add `title` to `TraceSummary`**

In `src/types.ts`, in `interface TraceSummary`, add after `pr_title: string | null;`:

```typescript
  title: string | null;
```

- [ ] **Step 2: Add `title` to `TracePatch`**

In `src/types.ts`, in `interface TracePatch`, add:

```typescript
  title?: string | null;
```

- [ ] **Step 3: Typecheck**

Run: `cd webapp/frontend && npx tsc -b`
Expected: this will FAIL in test/fixture files that build `TraceSummary` literals without `title` (e.g. `src/tests/components/TraceManageMenu.test.tsx`). That is expected and fixed in later tasks. To confirm the *types file itself* is valid, check that the only errors are "missing property 'title'":

Run: `cd webapp/frontend && npx tsc -b 2>&1 | grep -c "Property 'title' is missing"`
Expected: a non-zero count, and no other unrelated error types. (Do NOT commit yet; fixtures get `title` added in the tasks that touch them. If you prefer a green tree at every commit, jump to Step 4 to patch existing fixtures now.)

- [ ] **Step 4: Patch existing test fixtures that build TraceSummary**

Add `title: null,` to every `TraceSummary` object literal that currently omits it. Find them:

Run: `cd webapp/frontend && grep -rln "agent_count:" src/tests`
For each match (e.g. `src/tests/components/TraceManageMenu.test.tsx`, `src/tests/routes/TraceView.test.tsx`, `src/tests/routes/UserPage.test.tsx`, `src/tests/routes/PrTracesList.test.tsx`, `src/tests/api.test.ts`), add `title: null,` alongside the other fields in the fixture factory (next to `pr_title: null,`).

- [ ] **Step 5: Typecheck again**

Run: `cd webapp/frontend && npx tsc -b`
Expected: exit 0 (no errors).

- [ ] **Step 6: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/types.ts webapp/frontend/src/tests
git commit -m "Add title to frontend TraceSummary/TracePatch types"
```

---

## Task 6: HeroTitle component (display + inline owner editor)

**Files:**
- Create: `webapp/frontend/src/components/trace/HeroTitle.tsx`
- Test: `webapp/frontend/src/tests/trace/HeroTitle.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `webapp/frontend/src/tests/trace/HeroTitle.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { HeroTitle } from "../../components/trace/HeroTitle";
import type { TraceSummary } from "../../types";
import * as api from "../../api";

vi.mock("../../api");

function makeTrace(over: Partial<TraceSummary> = {}): TraceSummary {
  return {
    trace_id: "t1",
    short_id: "abc1234567",
    owner_login: "alice",
    repo_full_name: null,
    pr_number: null,
    pr_url: null,
    pr_title: null,
    title: null,
    platform: "web",
    byte_size: 1024,
    message_count: 5,
    created_at: "2026-05-20T10:00:00Z",
    is_private: false,
    agent_count: 0,
    agents: [],
    ...over,
  };
}

describe("HeroTitle", () => {
  afterEach(() => cleanup());

  it("prefers trace.title over aiTitle and the fallback", () => {
    render(
      <HeroTitle
        trace={makeTrace({ title: "Custom title" })}
        aiTitle="AI title"
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toContain("Custom title");
  });

  it("falls back to aiTitle, then to Untitled session", () => {
    const { rerender } = render(
      <HeroTitle
        trace={makeTrace()}
        aiTitle="AI title"
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toContain("AI title");
    rerender(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toContain(
      "Untitled session",
    );
  });

  it("hides the edit button for non-owners", () => {
    render(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /edit title/i })).toBeNull();
  });

  it("lets an owner edit and save the title", async () => {
    const updated = makeTrace({ title: "New title" });
    vi.mocked(api.patchTrace).mockResolvedValue(updated);
    const onUpdated = vi.fn();
    render(
      <HeroTitle
        trace={makeTrace()}
        aiTitle={null}
        canEdit
        onUpdated={onUpdated}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit title/i }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(api.patchTrace).toHaveBeenCalledWith("abc1234567", {
        title: "New title",
      }),
    );
    expect(onUpdated).toHaveBeenCalledWith(updated);
  });

  it("cancel exits edit mode without calling the API", () => {
    render(
      <HeroTitle
        trace={makeTrace({ title: "Original" })}
        aiTitle={null}
        canEdit
        onUpdated={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit title/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(api.patchTrace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading").textContent).toContain("Original");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd webapp/frontend && npm test -- src/tests/trace/HeroTitle.test.tsx`
Expected: FAIL with a module-not-found error for `../../components/trace/HeroTitle`.

- [ ] **Step 3: Implement `HeroTitle`**

Create `webapp/frontend/src/components/trace/HeroTitle.tsx`:

```tsx
import { useState } from "react";
import { ApiError, patchTrace } from "../../api";
import type { TraceSummary } from "../../types";

interface Props {
  trace: TraceSummary;
  /** Derived AI title from the parsed session, used as a fallback. */
  aiTitle: string | null;
  canEdit: boolean;
  onUpdated: (trace: TraceSummary) => void;
}

const MAX_TITLE = 200;

function displayTitle(trace: TraceSummary, aiTitle: string | null): string {
  return trace.title || aiTitle || "Untitled session";
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.body || `Request failed (${e.status})`;
  return e instanceof Error ? e.message : String(e);
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <path
        d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeroTitle({ trace, aiTitle, canEdit, onUpdated }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setValue(trace.title ?? "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await patchTrace(trace.short_id, { title: value });
      onUpdated(updated);
      setEditing(false);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="hero-title-edit">
        <input
          className="hero-title-input"
          type="text"
          value={value}
          maxLength={MAX_TITLE}
          placeholder="Add a title"
          autoFocus
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="hero-title-actions">
          <button
            type="button"
            className="hero-title-btn primary"
            disabled={busy}
            onClick={() => void save()}
          >
            Save
          </button>
          <button
            type="button"
            className="hero-title-btn"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
        {error && <span className="hero-title-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="hero-title-row">
      <h1 className="hero-title">{displayTitle(trace, aiTitle)}</h1>
      {canEdit && (
        <button
          type="button"
          className="hero-title-edit-btn"
          aria-label="Edit title"
          onClick={startEditing}
        >
          <PencilIcon />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd webapp/frontend && npm test -- src/tests/trace/HeroTitle.test.tsx`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/components/trace/HeroTitle.tsx webapp/frontend/src/tests/trace/HeroTitle.test.tsx
git commit -m "Add HeroTitle component with inline owner title editor"
```

---

## Task 7: Wire HeroTitle into Hero

**Files:**
- Modify: `webapp/frontend/src/components/trace/Hero.tsx` (imports; `Props` interface line 10-14; the `Hero` function line 175-190)

- [ ] **Step 1: Import HeroTitle and extend Props**

In `src/components/trace/Hero.tsx`, add to the imports at the top:

```typescript
import { HeroTitle } from "./HeroTitle";
```

Extend the `Props` interface (currently `session`, `trace`, `rawHref`) to add two optional fields:

```typescript
interface Props {
  session: Session;
  trace: TraceSummary;
  rawHref: string;
  canEdit?: boolean;
  onTraceUpdated?: (trace: TraceSummary) => void;
}
```

- [ ] **Step 2: Use HeroTitle in the Hero render**

In the `Hero` function, change the signature to destructure the new props and replace the `<h1>`:

```tsx
export function Hero({
  session,
  trace,
  rawHref,
  canEdit,
  onTraceUpdated,
}: Props) {
  const meta = session.meta;
  return (
    <section>
      <div className="hero">
        <HeroEyebrow session={session} trace={trace} rawHref={rawHref} />
        <HeroTitle
          trace={trace}
          aiTitle={meta.aiTitle}
          canEdit={!!canEdit}
          onUpdated={onTraceUpdated ?? (() => {})}
        />
        <HeroBadges trace={trace} />
      </div>
      <Outcome session={session} trace={trace} />
      <MetaLine session={session} />
      <ToolsChips session={session} />
      <Timeline session={session} />
    </section>
  );
}
```

Note: `HeroEyebrow` is declared with a `Props`-typed parameter but only uses `session`, `trace`, `rawHref`; the two new optional fields don't affect it. Leave `HeroEyebrow` unchanged.

- [ ] **Step 3: Typecheck**

Run: `cd webapp/frontend && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Run the existing Hero-related tests**

Run: `cd webapp/frontend && npm test -- src/tests/trace/metaline.test.tsx src/tests/trace/HeroTitle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/components/trace/Hero.tsx
git commit -m "Render HeroTitle in Hero with owner edit plumbing"
```

---

## Task 8: Thread title-edit props through TraceViewer and TraceView

**Files:**
- Modify: `webapp/frontend/src/components/trace/TraceViewer.tsx` (`Props` line 13-22; function signature/destructure line 24-32; `<Hero ...>` line 52)
- Modify: `webapp/frontend/src/routes/TraceView.tsx` (the `<TraceViewer ...>` render around line 118-128; `isOwner` is already computed at line 79)

- [ ] **Step 1: Extend TraceViewer Props and pass to Hero**

In `src/components/trace/TraceViewer.tsx`, add to the `Props` interface:

```typescript
  /** Whether the current viewer owns this trace (enables title editing). */
  canEditTitle?: boolean;
  /** Called with the updated summary after an owner edits the title. */
  onTraceUpdated?: (trace: TraceSummary) => void;
```

Add them to the destructured parameters:

```typescript
export function TraceViewer({
  trace,
  session,
  shortId,
  rawHref,
  repoOwner,
  repoName,
  ownerControls,
  canEditTitle,
  onTraceUpdated,
}: Props) {
```

And pass them to `<Hero>`:

```tsx
      <Hero
        session={session}
        trace={trace}
        rawHref={rawHref}
        canEdit={canEditTitle}
        onTraceUpdated={onTraceUpdated}
      />
```

(`TraceSummary` is already imported in this file.)

- [ ] **Step 2: Pass props from TraceView**

In `src/routes/TraceView.tsx`, update the `<TraceViewer ...>` element (around line 118) to add:

```tsx
        <TraceViewer
          trace={head.trace}
          session={session}
          shortId={head.trace.short_id}
          rawHref={`/api/traces/${head.trace.short_id}/raw`}
          repoOwner={repoParts[0]}
          repoName={repoParts[1]}
          ownerControls={ownerControls}
          canEditTitle={isOwner}
          onTraceUpdated={(updated) =>
            setHead({ kind: "ready", trace: updated })
          }
        />
```

`isOwner` is already defined at line 79. `setHead` is the same setter the manage menu's `onUpdated` uses, so title and association edits stay consistent.

- [ ] **Step 3: Typecheck**

Run: `cd webapp/frontend && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Run the TraceView route tests**

Run: `cd webapp/frontend && npm test -- src/tests/routes/TraceView.test.tsx`
Expected: PASS (existing behavior unchanged).

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/components/trace/TraceViewer.tsx webapp/frontend/src/routes/TraceView.tsx
git commit -m "Thread owner title-edit props through TraceViewer to Hero"
```

---

## Task 9: Active Time "not available" for text imports

**Files:**
- Modify: `webapp/frontend/src/components/trace/Outcome.tsx` (the Active Time `StatCell`, around lines 138-195)
- Test: `webapp/frontend/src/tests/trace/outcome.test.tsx`

`Outcome` renders `useSubagentStreams`, which only calls `fetchAgentJsonl` when `trace.agents` is non-empty. The tests below use an empty `agents` list, so no network mock is needed.

- [ ] **Step 1: Write the failing test**

Create `webapp/frontend/src/tests/trace/outcome.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Outcome } from "../../components/trace/Outcome";
import type { Session } from "../../components/trace/types";
import type { TraceSummary } from "../../types";

function makeSession(over: Partial<Session["meta"]> = {}): Session {
  return {
    stream: [],
    meta: {
      sessionId: null,
      aiTitle: null,
      firstPrompt: null,
      cwd: null,
      gitBranch: null,
      model: null,
      modelLabel: null,
      sourceFormat: null,
      version: null,
      permissionMode: null,
      startedAt: null,
      endedAt: null,
      prLink: null,
      tokens: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      assistantThinkMs: 0,
      toolCounts: {},
      toolCallCount: 0,
      userPromptCount: 0,
      assistantTextCount: 0,
      agents: [],
      ...over,
    },
  };
}

function makeTrace(over: Partial<TraceSummary> = {}): TraceSummary {
  return {
    trace_id: "t1",
    short_id: "abc1234567",
    owner_login: "alice",
    repo_full_name: null,
    pr_number: null,
    pr_url: null,
    pr_title: null,
    title: null,
    platform: "web",
    byte_size: 1024,
    message_count: 5,
    created_at: "2026-05-20T10:00:00Z",
    is_private: false,
    agent_count: 0,
    agents: [],
    ...over,
  };
}

function renderOutcome(session: Session, trace: TraceSummary) {
  return render(
    <MemoryRouter>
      <Outcome session={session} trace={trace} />
    </MemoryRouter>,
  );
}

describe("Outcome Active Time", () => {
  afterEach(() => cleanup());

  it("shows 'not available' for text-import traces", () => {
    renderOutcome(makeSession({ sourceFormat: "terminal" }), makeTrace());
    expect(screen.getByText(/not available for text imports/i)).toBeTruthy();
    expect(screen.queryByText(/^wall:/)).toBeNull();
  });

  it("shows a duration and wall time for ordinary traces", () => {
    const session = makeSession({
      assistantThinkMs: 5000,
      startedAt: "2026-05-20T10:00:00Z",
      endedAt: "2026-05-20T10:01:00Z",
    });
    renderOutcome(session, makeTrace());
    expect(screen.queryByText(/not available for text imports/i)).toBeNull();
    expect(screen.getByText(/^wall:/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd webapp/frontend && npm test -- src/tests/trace/outcome.test.tsx`
Expected: the first test FAILS (the "not available for text imports" text is not rendered; current code shows "0s" / "wall: 0s").

- [ ] **Step 3: Implement the conditional Active Time cell**

In `src/components/trace/Outcome.tsx`, inside the `Outcome` function, add a derived flag near the top of the component body (after `const { meta, stream } = session;`, around line 139):

```typescript
  const isTextImport = meta.sourceFormat === "terminal";
```

Then replace the existing Active Time `StatCell` (the first `<StatCell label="Active Time" ... />`) with a conditional:

```tsx
          {isTextImport ? (
            <StatCell
              label="Active Time"
              value="n/a"
              sub="not available for text imports"
            />
          ) : (
            <StatCell
              label="Active Time"
              value={fmtDurationCompact(meta.assistantThinkMs)}
              sub={`wall: ${fmtDuration(wall)}`}
            />
          )}
```

Leave the `Turns` and `Tool calls` cells unchanged. `wall`, `fmtDuration`, and `fmtDurationCompact` remain in use by the non-import branch, so no imports change.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd webapp/frontend && npm test -- src/tests/trace/outcome.test.tsx`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/components/trace/Outcome.tsx webapp/frontend/src/tests/trace/outcome.test.tsx
git commit -m "Show 'not available for text imports' for Active Time on text traces"
```

---

## Task 10: Styles for the inline title editor

**Files:**
- Modify: `webapp/frontend/src/styles/viewer.css` (append after the existing `.vibeshub-viewer .hero-title { ... }` rule at lines 420-428, which ends with `text-wrap: balance;` then `}` on line 428, just before the `.vibeshub-viewer .hero-badges` rule)

- [ ] **Step 1: Add the editor styles**

Append the following CSS in `src/styles/viewer.css` immediately after the `.vibeshub-viewer .hero-title { ... }` block (after line 428, before `.vibeshub-viewer .hero-badges`):

```css
.vibeshub-viewer .hero-title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.vibeshub-viewer .hero-title-row .hero-title {
  margin-bottom: 18px;
}

.vibeshub-viewer .hero-title-edit-btn {
  flex-shrink: 0;
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-muted, var(--text));
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease;
}

.vibeshub-viewer .hero-title-row:hover .hero-title-edit-btn,
.vibeshub-viewer .hero-title-edit-btn:focus-visible {
  opacity: 1;
}

.vibeshub-viewer .hero-title-edit-btn:hover {
  color: var(--text-strong);
}

.vibeshub-viewer .hero-title-edit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 0 18px;
}

.vibeshub-viewer .hero-title-input {
  flex: 1 1 320px;
  min-width: 0;
  font-size: 28px;
  font-weight: 680;
  letter-spacing: -0.6px;
  color: var(--text-strong);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 12px;
}

.vibeshub-viewer .hero-title-input:focus {
  outline: none;
  border-color: var(--accent, var(--text-strong));
}

.vibeshub-viewer .hero-title-actions {
  display: inline-flex;
  gap: 8px;
}

.vibeshub-viewer .hero-title-btn {
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.vibeshub-viewer .hero-title-btn.primary {
  background: var(--accent-soft, var(--surface));
  color: var(--text-strong);
  border-color: var(--accent, var(--border));
}

.vibeshub-viewer .hero-title-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.vibeshub-viewer .hero-title-error {
  flex-basis: 100%;
  color: var(--danger, #c0392b);
  font-size: 13px;
}

/* On touch / small screens the hover affordance never triggers; keep the
   pencil visible so owners can still find it. */
@media (max-width: 640px) {
  .vibeshub-viewer .hero-title-edit-btn {
    opacity: 1;
  }
}
```

- [ ] **Step 2: Verify the build still compiles the CSS**

Run: `cd webapp/frontend && npx tsc -b && npm run build`
Expected: build succeeds (CSS is bundled by Vite without error).

If `npm run build` is too slow or unavailable in your environment, a typecheck (`npx tsc -b`) plus a visual check in Task 11 is sufficient; CSS errors do not fail tsc, so rely on the Task 11 screenshot.

- [ ] **Step 3: Commit**

```bash
cd /Users/bhavya/git/vibeshub
git add webapp/frontend/src/styles/viewer.css
git commit -m "Style the inline hero title editor"
```

---

## Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Backend test suite**

Run: `cd webapp/backend && ../../env/bin/pytest -q`
Expected: all tests pass (no failures, no errors). If unrelated pre-existing failures appear, note them but ensure the title tests in `test_traces_patch.py` pass.

- [ ] **Step 2: Frontend test suite**

Run: `cd webapp/frontend && npm test`
Expected: all suites pass, including `HeroTitle.test.tsx` and `outcome.test.tsx`.

- [ ] **Step 3: Frontend typecheck**

Run: `cd webapp/frontend && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Manual/visual smoke (optional but recommended)**

If there is a project `run`/dev workflow, load a text-import trace (e.g. the `#85` trace, or upload `webapp/frontend/src/tests/fixtures/sample-terminal-export.txt`) and confirm:
- As the owner, a pencil appears next to the title on hover; clicking it shows the input + Save/Cancel; saving updates the heading and persists across reload.
- A non-owner sees no pencil.
- Active Time reads "n/a" with "not available for text imports" and no "wall:" line for the text-import trace, while an ordinary `.jsonl` trace still shows a duration and wall time.

- [ ] **Step 5: Final review of the diff**

Run: `cd /Users/bhavya/git/vibeshub && git log --oneline main..HEAD && git diff --stat main...HEAD`
Expected: the commit series from Tasks 1-10, touching only the files listed in this plan.

---

## Self-Review Notes

- **Spec coverage:** Feature A (editable title) = Tasks 1-8; Feature B (Active Time) = Task 9; styling = Task 10; verification = Task 11. The spec's "Files touched" list maps 1:1 to the tasks above (the spec mentioned `api.ts` may not change — confirmed: `patchTrace` already forwards arbitrary `TracePatch`, so no change needed).
- **Type consistency:** `title` is `str | None` (backend) / `string | null` (TraceSummary) / `string | null` optional (TracePatch). `HeroTitle` props (`trace`, `aiTitle`, `canEdit`, `onUpdated`) match how `Hero` calls it; `Hero`'s `canEdit`/`onTraceUpdated` match what `TraceViewer` passes (`canEditTitle`/`onTraceUpdated`); `TraceViewer`'s props match what `TraceView` supplies (`isOwner`, `setHead`).
- **Title cap:** enforced server-side (reject > 200 with HTTP 400) and bounded client-side (`maxLength={200}`), per the approved spec.
- **No new placeholders.** All code steps contain complete code.
