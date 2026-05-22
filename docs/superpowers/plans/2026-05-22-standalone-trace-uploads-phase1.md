# Standalone Trace Uploads — Phase 1: Data Model & Access Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `Trace` able to exist without a repo/PR association, gate private standalone traces to their owner, and extract the blob-write + session-id upsert into a shared `create_or_update_trace` service that the existing ingest path calls.

**Architecture:** Three `Trace` columns (`repo_full_name`, `pr_number`, `pr_url`) become nullable via one Alembic migration; existing rows already populate them so they are untouched. `_require_trace_access` / `_filter_visible` in `traces.py` grow a standalone branch — a standalone-private trace is visible only to its `owner_login`, while repo-associated traces keep today's live `RepoAccessChecker` behavior. The inline blob-writing and session-id upsert in `ingest.py` move into a new `app/api/trace_service.py` exposing `create_or_update_trace(...)`; `ingest.py` is rewired to call it so every existing test stays green.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, pytest + pytest-asyncio (`asyncio_mode = auto`), respx for GitHub mocking, SQLite (`:memory:`) in tests / Postgres in prod.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `webapp/backend/app/storage/models.py` | modified | `Trace.repo_full_name`, `Trace.pr_number`, `Trace.pr_url` become `Mapped[Optional[...]]` with `nullable=True`. |
| `webapp/backend/alembic/versions/3a1f9c2b5e07_traces_repo_pr_nullable.py` | created | One migration altering the three columns to nullable; dialect-branched (Postgres `alter_column` / SQLite `batch_alter_table`). |
| `webapp/backend/app/api/schemas.py` | modified | `TraceSummary.repo_full_name`, `.pr_number`, `.pr_url` become `… | None`. |
| `webapp/backend/app/api/trace_service.py` | created | `TraceWriteResult` dataclass + `create_or_update_trace(...)`: blob writes under `traces/<sid>/`, session-id upsert keyed on `(repo_full_name, pr_number, session_id)` or on `session_id` alone for standalone uploads, returns row + `created`. |
| `webapp/backend/app/api/ingest.py` | modified | The inline blob-write + upsert block is replaced by a call to `create_or_update_trace`; the endpoint's external behavior is unchanged. |
| `webapp/backend/app/api/traces.py` | modified | `_require_trace_access` and `_filter_visible` / `_can_view_repo` gain a standalone branch; `_require_trace_access` signature threads the viewer through; `get_trace` / `get_trace_raw` / `get_agent_raw` updated callers. |
| `webapp/backend/tests/test_migration_repo_pr_nullable.py` | created | Verifies a `Trace` row can be inserted with `repo_full_name`/`pr_number`/`pr_url` all NULL. |
| `webapp/backend/tests/test_trace_service.py` | created | Unit tests for `create_or_update_trace`: standalone create, repo-associated create, repo upsert, standalone upsert-on-session-id. |
| `webapp/backend/tests/test_standalone_access.py` | created | Access matrix for standalone-private traces: anonymous → 401, signed-in non-owner → 404, owner → 200, plus `_filter_visible` on `/api/users/{login}`. |

---

## Task 1: Make `Trace` repo/PR columns nullable in the model

**Files:**
- `webapp/backend/app/storage/models.py`
- `webapp/backend/tests/test_models.py`

- [ ] **Step 1: Write a failing test that a standalone Trace row persists.**
  Append to `webapp/backend/tests/test_models.py`:
  ```python
  @pytest.mark.asyncio
  async def test_trace_allows_null_repo_and_pr():
      """A standalone trace carries no repo_full_name / pr_number / pr_url."""
      engine = engine_for("sqlite+aiosqlite:///:memory:")
      await create_all(engine)
      SessionLocal = session_maker_for(engine)

      async with SessionLocal() as db_session:
          trace = Trace(
              short_id="standalone1",
              owner_login="alice",
              repo_full_name=None,
              pr_number=None,
              pr_url=None,
              pr_title=None,
              platform="claude-code",
              byte_size=10,
              message_count=1,
              blob_prefix="traces/standalone1/",
              agents=[],
              agent_count=0,
          )
          db_session.add(trace)
          await db_session.commit()

          row = (
              await db_session.execute(
                  select(Trace).where(Trace.short_id == "standalone1")
              )
          ).scalar_one()
          assert row.repo_full_name is None
          assert row.pr_number is None
          assert row.pr_url is None
  ```

- [ ] **Step 2: Run the test and see it fail.**
  Command (run from `webapp/backend/`):
  ```
  python -m pytest tests/test_models.py::test_trace_allows_null_repo_and_pr -q
  ```
  Expected: 1 failed — an `IntegrityError` (`NOT NULL constraint failed: traces.repo_full_name`) raised on `commit()`.

- [ ] **Step 3: Make the three columns nullable in the model.**
  In `webapp/backend/app/storage/models.py`, replace these three lines:
  ```python
      repo_full_name: Mapped[str] = mapped_column(String(255), index=True)
      pr_number: Mapped[int] = mapped_column(Integer, index=True)
      pr_url: Mapped[str] = mapped_column(String(512))
  ```
  with:
  ```python
      # Nullable since 2026-05-22: a standalone trace has no PR/repo. See the
      # standalone-trace-uploads design. owner_login stays non-null — it is
      # always the uploader. The indexes are kept; nullable indexed columns
      # are fine on both Postgres and SQLite.
      repo_full_name: Mapped[Optional[str]] = mapped_column(
          String(255), index=True, nullable=True
      )
      pr_number: Mapped[Optional[int]] = mapped_column(
          Integer, index=True, nullable=True
      )
      pr_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
  ```

- [ ] **Step 4: Run the test and see it pass.**
  Command:
  ```
  python -m pytest tests/test_models.py -q
  ```
  Expected: 3 passed (`test_trace_has_new_subagent_columns`, `test_trace_is_private_defaults_false`, `test_trace_allows_null_repo_and_pr`).

- [ ] **Step 5: Commit.**
  ```
  git add webapp/backend/app/storage/models.py webapp/backend/tests/test_models.py
  git commit -m "$(cat <<'EOF'
  Make Trace repo/PR columns nullable for standalone traces

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2: Alembic migration altering the three columns to nullable

**Files:**
- `webapp/backend/alembic/versions/3a1f9c2b5e07_traces_repo_pr_nullable.py`
- `webapp/backend/tests/test_migration_repo_pr_nullable.py`

- [ ] **Step 1: Write a failing test that the migration applies and allows NULLs.**
  Create `webapp/backend/tests/test_migration_repo_pr_nullable.py`:
  ```python
  """The repo/PR-nullable migration applies cleanly and relaxes the three
  columns to nullable on a freshly-migrated SQLite database."""
  from pathlib import Path

  import pytest
  from alembic import command
  from alembic.config import Config
  from sqlalchemy import create_engine, insert, text
  from sqlalchemy.orm import Session

  from app.storage.models import Trace

  BACKEND_ROOT = Path(__file__).resolve().parents[1]


  def _alembic_config(database_url: str) -> Config:
      cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
      cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
      cfg.set_main_option("sqlalchemy.url", database_url)
      return cfg


  def test_migration_relaxes_repo_pr_to_nullable(tmp_path, monkeypatch):
      db_path = tmp_path / "migration.db"
      url = f"sqlite:///{db_path}"
      monkeypatch.setenv("VIBESHUB_DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")

      command.upgrade(_alembic_config(url), "head")

      engine = create_engine(url)
      with Session(engine) as session:
          session.execute(
              insert(Trace).values(
                  short_id="migstandalone",
                  owner_login="alice",
                  repo_full_name=None,
                  pr_number=None,
                  pr_url=None,
                  pr_title=None,
                  platform="claude-code",
                  byte_size=1,
                  message_count=0,
                  redaction_count_client=0,
                  redaction_count_server=0,
                  is_private=False,
                  blob_prefix="traces/migstandalone/",
                  agent_count=0,
              )
          )
          session.commit()
          row = session.execute(
              text("SELECT repo_full_name, pr_number, pr_url FROM traces "
                   "WHERE short_id = 'migstandalone'")
          ).one()
          assert row == (None, None, None)
      engine.dispose()
  ```

- [ ] **Step 2: Run the test and see it fail.**
  Command (from `webapp/backend/`):
  ```
  python -m pytest tests/test_migration_repo_pr_nullable.py -q
  ```
  Expected: 1 failed — `command.upgrade(..., "head")` succeeds against the *current* head `7f3c1a9b2d4e`, but the `INSERT` raises `IntegrityError` (`NOT NULL constraint failed: traces.repo_full_name`) because no migration has relaxed the columns yet.

- [ ] **Step 3: Create the Alembic migration.**
  Create `webapp/backend/alembic/versions/3a1f9c2b5e07_traces_repo_pr_nullable.py`:
  ```python
  """traces repo/pr columns nullable

  Revision ID: 3a1f9c2b5e07
  Revises: 7f3c1a9b2d4e
  Create Date: 2026-05-22 12:00:00.000000

  """
  from typing import Sequence, Union

  from alembic import op
  import sqlalchemy as sa


  # revision identifiers, used by Alembic.
  revision: str = "3a1f9c2b5e07"
  down_revision: Union[str, Sequence[str], None] = "7f3c1a9b2d4e"
  branch_labels: Union[str, Sequence[str], None] = None
  depends_on: Union[str, Sequence[str], None] = None


  def upgrade() -> None:
      """Relax `repo_full_name`, `pr_number`, `pr_url` to nullable so a
      standalone trace (no PR/repo) can be stored.

      Existing rows all populate the three columns, so they are untouched —
      this only widens the column constraint. On Postgres a native
      ALTER TABLE ... ALTER COLUMN DROP NOT NULL suffices. SQLite has no
      ALTER COLUMN, so we recreate the table via batch mode. The indexes on
      `repo_full_name` and `pr_number` are preserved.
      """
      bind = op.get_bind()
      dialect = bind.dialect.name

      if dialect == "postgresql":
          op.alter_column("traces", "repo_full_name", nullable=True)
          op.alter_column("traces", "pr_number", nullable=True)
          op.alter_column("traces", "pr_url", nullable=True)
      else:
          with op.batch_alter_table("traces", recreate="always") as batch_op:
              batch_op.alter_column(
                  "repo_full_name",
                  existing_type=sa.String(length=255),
                  nullable=True,
              )
              batch_op.alter_column(
                  "pr_number",
                  existing_type=sa.Integer(),
                  nullable=True,
              )
              batch_op.alter_column(
                  "pr_url",
                  existing_type=sa.String(length=512),
                  nullable=True,
              )


  def downgrade() -> None:
      """Re-tighten the three columns to NOT NULL.

      This will fail if any standalone (NULL repo/PR) rows exist — that is
      intentional, since a NOT NULL column cannot hold them.
      """
      bind = op.get_bind()
      dialect = bind.dialect.name

      if dialect == "postgresql":
          op.alter_column("traces", "repo_full_name", nullable=False)
          op.alter_column("traces", "pr_number", nullable=False)
          op.alter_column("traces", "pr_url", nullable=False)
      else:
          with op.batch_alter_table("traces", recreate="always") as batch_op:
              batch_op.alter_column(
                  "repo_full_name",
                  existing_type=sa.String(length=255),
                  nullable=False,
              )
              batch_op.alter_column(
                  "pr_number",
                  existing_type=sa.Integer(),
                  nullable=False,
              )
              batch_op.alter_column(
                  "pr_url",
                  existing_type=sa.String(length=512),
                  nullable=False,
              )
  ```

- [ ] **Step 4: Run the test and see it pass.**
  Command:
  ```
  python -m pytest tests/test_migration_repo_pr_nullable.py -q
  ```
  Expected: 1 passed.

- [ ] **Step 5: Confirm the migration is the new single head.**
  Command:
  ```
  python -m alembic heads
  ```
  Expected output: `3a1f9c2b5e07 (head)` — a single head, no branches.

- [ ] **Step 6: Commit.**
  ```
  git add webapp/backend/alembic/versions/3a1f9c2b5e07_traces_repo_pr_nullable.py webapp/backend/tests/test_migration_repo_pr_nullable.py
  git commit -m "$(cat <<'EOF'
  Add migration relaxing traces repo/PR columns to nullable

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: `TraceSummary` schema — optional repo/PR fields

**Files:**
- `webapp/backend/app/api/schemas.py`
- `webapp/backend/tests/test_standalone_access.py`

- [ ] **Step 1: Write a failing test that `TraceSummary` accepts null repo/PR.**
  Create `webapp/backend/tests/test_standalone_access.py`:
  ```python
  """Access control and schema behavior for standalone (no repo/PR) traces."""
  import pytest

  from app.api.schemas import TraceSummary


  def test_trace_summary_accepts_null_repo_and_pr():
      summary = TraceSummary(
          trace_id="t-1",
          short_id="standalone1",
          owner_login="alice",
          repo_full_name=None,
          pr_number=None,
          pr_url=None,
          pr_title=None,
          platform="claude-code",
          byte_size=10,
          message_count=1,
          created_at="2026-05-22T00:00:00+00:00",
          is_private=False,
      )
      dumped = summary.model_dump()
      assert dumped["repo_full_name"] is None
      assert dumped["pr_number"] is None
      assert dumped["pr_url"] is None
  ```

- [ ] **Step 2: Run the test and see it fail.**
  Command:
  ```
  python -m pytest tests/test_standalone_access.py::test_trace_summary_accepts_null_repo_and_pr -q
  ```
  Expected: 1 failed — `pydantic.ValidationError`, three errors of the form `Input should be a valid string` / `... integer` for `repo_full_name`, `pr_number`, `pr_url` (currently non-optional).

- [ ] **Step 3: Make the three `TraceSummary` fields optional.**
  In `webapp/backend/app/api/schemas.py`, replace these three lines:
  ```python
      repo_full_name: str
      pr_number: int
      pr_url: str
  ```
  with:
  ```python
      # None for a standalone trace (no PR/repo association).
      repo_full_name: str | None
      pr_number: int | None
      pr_url: str | None
  ```

- [ ] **Step 4: Run the test and see it pass.**
  Command:
  ```
  python -m pytest tests/test_standalone_access.py::test_trace_summary_accepts_null_repo_and_pr -q
  ```
  Expected: 1 passed.

- [ ] **Step 5: Commit.**
  ```
  git add webapp/backend/app/api/schemas.py webapp/backend/tests/test_standalone_access.py
  git commit -m "$(cat <<'EOF'
  Allow null repo/PR fields in TraceSummary schema

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: Create the `trace_service` module with `TraceWriteResult`

**Files:**
- `webapp/backend/app/api/trace_service.py`
- `webapp/backend/tests/test_trace_service.py`

- [ ] **Step 1: Write a failing test that a standalone trace is created.**
  Create `webapp/backend/tests/test_trace_service.py`:
  ```python
  """Unit tests for app.api.trace_service.create_or_update_trace."""
  import pytest
  from sqlalchemy import select

  from app.api.trace_service import TraceWriteResult, create_or_update_trace
  from app.redact.bundle import UnpackedBundle
  from app.storage.blob import LocalDirBlobStore
  from app.storage.db import create_all, engine_for, session_maker_for
  from app.storage.models import Trace


  def _bundle() -> UnpackedBundle:
      return UnpackedBundle(
          main_bytes=b'{"type":"user"}\n',
          agents=[],
          total_redactions=0,
      )


  async def _fresh_db():
      engine = engine_for("sqlite+aiosqlite:///:memory:")
      await create_all(engine)
      return session_maker_for(engine)


  @pytest.mark.asyncio
  async def test_create_standalone_trace(tmp_path):
      SessionLocal = await _fresh_db()
      blob_store = LocalDirBlobStore(tmp_path / "blobs")

      async with SessionLocal() as session:
          result = await create_or_update_trace(
              session=session,
              blob_store=blob_store,
              unpacked=_bundle(),
              owner_login="alice",
              platform="claude-code",
              plugin_version="0.2.0",
              session_id=None,
              redaction_count_client=0,
              repo_full_name=None,
              pr_number=None,
              pr_url=None,
              pr_title=None,
              is_private=False,
          )
          await session.commit()

      assert isinstance(result, TraceWriteResult)
      assert result.created is True
      assert result.trace.repo_full_name is None
      assert result.trace.pr_number is None
      assert result.trace.pr_url is None
      assert result.trace.owner_login == "alice"
      assert result.trace.blob_prefix == f"traces/{result.trace.short_id}/"
      # The main blob was written.
      assert await blob_store.get(
          f"traces/{result.trace.short_id}/main.jsonl"
      ) == b'{"type":"user"}\n'
  ```

- [ ] **Step 2: Run the test and see it fail.**
  Command:
  ```
  python -m pytest tests/test_trace_service.py::test_create_standalone_trace -q
  ```
  Expected: collection error — `ModuleNotFoundError: No module named 'app.api.trace_service'`.

- [ ] **Step 3: Create the `trace_service` module.**
  Create `webapp/backend/app/api/trace_service.py`:
  ```python
  """Shared trace-creation service.

  `create_or_update_trace` is the single place that writes trace blobs and
  performs the session-id upsert. Both ingest paths — `/api/ingest` (CLI tar
  uploads) and the future `/api/uploads` (web multipart uploads) — call it so
  the storage layout, the redaction-count bookkeeping, and the upsert rule
  stay identical across paths.

  Upsert rule: a re-upload carrying the same `session_id` refreshes that
  session's existing trace (stable short_id / URL) instead of inserting a new
  row. For a repo-associated upload the match is scoped to
  `(repo_full_name, pr_number, session_id)`; for a standalone upload (repo and
  PR both None) the match is `session_id` alone among the uploader's own
  standalone, non-deleted traces. A null `session_id` always creates a fresh
  trace. A soft-deleted trace (`deleted_at` set) is never resurrected.

  This is a best-effort select-then-update — there is no unique constraint —
  but `session_id` is unique per Claude Code session and its upload hook is
  synchronous, so concurrent same-session uploads do not occur in practice.
  """
  from __future__ import annotations

  import json
  from dataclasses import dataclass

  from sqlalchemy import select
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.message_count import count_messages
  from app.redact.bundle import UnpackedBundle
  from app.short_id import generate
  from app.storage.blob import BlobStore
  from app.storage.models import Trace


  @dataclass
  class TraceWriteResult:
      trace: Trace
      created: bool


  async def _find_existing(
      session: AsyncSession,
      *,
      owner_login: str,
      repo_full_name: str | None,
      pr_number: int | None,
      session_id: str | None,
  ) -> Trace | None:
      """Return the trace this upload should refresh, or None to create one."""
      if not session_id:
          return None
      stmt = select(Trace).where(
          Trace.session_id == session_id,
          Trace.deleted_at.is_(None),
      )
      if repo_full_name is not None and pr_number is not None:
          # Repo-associated: scope the match to this exact PR (today's rule).
          stmt = stmt.where(
              Trace.repo_full_name == repo_full_name,
              Trace.pr_number == pr_number,
          )
      else:
          # Standalone: match this uploader's own standalone traces only.
          stmt = stmt.where(
              Trace.owner_login == owner_login,
              Trace.repo_full_name.is_(None),
          )
      stmt = stmt.order_by(Trace.created_at.desc())
      return (await session.execute(stmt)).scalars().first()


  async def create_or_update_trace(
      *,
      session: AsyncSession,
      blob_store: BlobStore,
      unpacked: UnpackedBundle,
      owner_login: str,
      platform: str,
      plugin_version: str | None,
      session_id: str | None,
      redaction_count_client: int,
      repo_full_name: str | None,
      pr_number: int | None,
      pr_url: str | None,
      pr_title: str | None,
      is_private: bool,
  ) -> TraceWriteResult:
      """Write the bundle's blobs and create or refresh the matching Trace row.

      The caller owns the transaction — this function adds/mutates the row and
      writes blobs but does NOT commit.
      """
      existing = await _find_existing(
          session,
          owner_login=owner_login,
          repo_full_name=repo_full_name,
          pr_number=pr_number,
          session_id=session_id,
      )

      created = existing is None
      sid = existing.short_id if existing is not None else generate()
      blob_prefix = f"traces/{sid}/"
      await blob_store.put(f"{blob_prefix}main.jsonl", unpacked.main_bytes)

      agent_summaries: list[dict] = []
      for agent in unpacked.agents:
          await blob_store.put(
              f"{blob_prefix}agents/{agent.agent_id}.jsonl",
              agent.jsonl_bytes,
          )
          await blob_store.put(
              f"{blob_prefix}agents/{agent.agent_id}.meta.json",
              json.dumps(agent.meta, ensure_ascii=False).encode("utf-8"),
          )
          agent_summaries.append({
              "agent_id": agent.agent_id,
              "tool_use_id": agent.meta.get("toolUseId"),
              "agent_type": agent.meta["agentType"],
              "description": agent.meta["description"],
              "message_count": count_messages(agent.jsonl_bytes),
          })

      message_count_main = count_messages(unpacked.main_bytes)
      byte_size = len(unpacked.main_bytes) + sum(
          len(a.jsonl_bytes) for a in unpacked.agents
      )

      if existing is not None:
          trace = existing
          trace.repo_full_name = repo_full_name
          trace.pr_number = pr_number
          trace.pr_url = pr_url
          trace.pr_title = pr_title
          trace.platform = platform
          trace.plugin_version = plugin_version
          trace.byte_size = byte_size
          trace.message_count = message_count_main
          trace.redaction_count_client = redaction_count_client
          trace.redaction_count_server = unpacked.total_redactions
          trace.is_private = is_private
          trace.blob_path = None
          trace.blob_prefix = blob_prefix
          trace.agents = agent_summaries
          trace.agent_count = len(agent_summaries)
      else:
          trace = Trace(
              short_id=sid,
              owner_login=owner_login,
              repo_full_name=repo_full_name,
              pr_number=pr_number,
              pr_url=pr_url,
              pr_title=pr_title,
              platform=platform,
              plugin_version=plugin_version,
              session_id=session_id,
              byte_size=byte_size,
              message_count=message_count_main,
              redaction_count_client=redaction_count_client,
              redaction_count_server=unpacked.total_redactions,
              is_private=is_private,
              blob_path=None,
              blob_prefix=blob_prefix,
              agents=agent_summaries,
              agent_count=len(agent_summaries),
          )
          session.add(trace)

      return TraceWriteResult(trace=trace, created=created)
  ```

- [ ] **Step 4: Run the test and see it pass.**
  Command:
  ```
  python -m pytest tests/test_trace_service.py::test_create_standalone_trace -q
  ```
  Expected: 1 passed.

- [ ] **Step 5: Commit.**
  ```
  git add webapp/backend/app/api/trace_service.py webapp/backend/tests/test_trace_service.py
  git commit -m "$(cat <<'EOF'
  Add trace_service.create_or_update_trace shared service

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: `trace_service` — repo-associated create + agents

**Files:**
- `webapp/backend/tests/test_trace_service.py`

- [ ] **Step 1: Write a failing test that a repo-associated trace with an agent is created.**
  Append to `webapp/backend/tests/test_trace_service.py`:
  ```python
  from app.redact.bundle import AgentPiece


  @pytest.mark.asyncio
  async def test_create_repo_associated_trace_with_agent(tmp_path):
      SessionLocal = await _fresh_db()
      blob_store = LocalDirBlobStore(tmp_path / "blobs")
      aid = "a0123456789abcdef"
      bundle = UnpackedBundle(
          main_bytes=b'{"type":"user"}\n',
          agents=[AgentPiece(
              agent_id=aid,
              jsonl_bytes=b'{"type":"assistant"}\n',
              meta={
                  "agentType": "Explore",
                  "description": "d",
                  "toolUseId": "toolu_01x",
              },
          )],
          total_redactions=3,
      )

      async with SessionLocal() as session:
          result = await create_or_update_trace(
              session=session,
              blob_store=blob_store,
              unpacked=bundle,
              owner_login="alice",
              platform="claude-code",
              plugin_version="0.2.0",
              session_id=None,
              redaction_count_client=2,
              repo_full_name="alice/repo",
              pr_number=7,
              pr_url="https://github.com/alice/repo/pull/7",
              pr_title="Add a feature",
              is_private=True,
          )
          await session.commit()
          sid = result.trace.short_id

      assert result.created is True
      assert result.trace.repo_full_name == "alice/repo"
      assert result.trace.pr_number == 7
      assert result.trace.is_private is True
      assert result.trace.redaction_count_server == 3
      assert result.trace.agent_count == 1
      assert result.trace.agents == [{
          "agent_id": aid,
          "tool_use_id": "toolu_01x",
          "agent_type": "Explore",
          "description": "d",
          "message_count": 0,
      }]
      assert await blob_store.get(f"traces/{sid}/agents/{aid}.jsonl") == (
          b'{"type":"assistant"}\n'
      )
  ```

- [ ] **Step 2: Run the test and see it pass immediately (no implementation change needed).**
  Command:
  ```
  python -m pytest tests/test_trace_service.py -q
  ```
  Expected: 2 passed. This test exercises an already-implemented branch of Task 4's code; it locks in the repo-associated path so future changes cannot silently break it. If it fails, fix `trace_service.py` before continuing.

- [ ] **Step 3: Commit.**
  ```
  git add webapp/backend/tests/test_trace_service.py
  git commit -m "$(cat <<'EOF'
  Test repo-associated trace creation in trace_service

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: `trace_service` — session-id upsert (repo + standalone)

**Files:**
- `webapp/backend/tests/test_trace_service.py`

- [ ] **Step 1: Write a failing test for the repo-scoped upsert.**
  Append to `webapp/backend/tests/test_trace_service.py`:
  ```python
  @pytest.mark.asyncio
  async def test_repo_upsert_refreshes_same_session(tmp_path):
      SessionLocal = await _fresh_db()
      blob_store = LocalDirBlobStore(tmp_path / "blobs")

      async def _write(main: bytes):
          async with SessionLocal() as session:
              result = await create_or_update_trace(
                  session=session,
                  blob_store=blob_store,
                  unpacked=UnpackedBundle(
                      main_bytes=main, agents=[], total_redactions=0
                  ),
                  owner_login="alice",
                  platform="claude-code",
                  plugin_version="0.2.0",
                  session_id="sess-R",
                  redaction_count_client=0,
                  repo_full_name="alice/repo",
                  pr_number=1,
                  pr_url="https://github.com/alice/repo/pull/1",
                  pr_title="t",
                  is_private=False,
              )
              await session.commit()
              return result

      first = await _write(b'{"type":"user"}\n')
      second = await _write(b'{"type":"user"}\n{"type":"assistant"}\n')

      assert first.created is True
      assert second.created is False
      assert second.trace.short_id == first.trace.short_id

      async with SessionLocal() as session:
          rows = (await session.execute(
              select(Trace).where(Trace.session_id == "sess-R")
          )).scalars().all()
      assert len(rows) == 1
      assert rows[0].byte_size > len(b'{"type":"user"}\n')


  @pytest.mark.asyncio
  async def test_standalone_upsert_keys_on_session_id_alone(tmp_path):
      SessionLocal = await _fresh_db()
      blob_store = LocalDirBlobStore(tmp_path / "blobs")

      async def _write_standalone():
          async with SessionLocal() as session:
              result = await create_or_update_trace(
                  session=session,
                  blob_store=blob_store,
                  unpacked=UnpackedBundle(
                      main_bytes=b'{"type":"user"}\n',
                      agents=[],
                      total_redactions=0,
                  ),
                  owner_login="alice",
                  platform="claude-code",
                  plugin_version="0.2.0",
                  session_id="sess-S",
                  redaction_count_client=0,
                  repo_full_name=None,
                  pr_number=None,
                  pr_url=None,
                  pr_title=None,
                  is_private=False,
              )
              await session.commit()
              return result

      first = await _write_standalone()
      second = await _write_standalone()

      assert first.created is True
      assert second.created is False
      assert second.trace.short_id == first.trace.short_id

      async with SessionLocal() as session:
          rows = (await session.execute(
              select(Trace).where(Trace.session_id == "sess-S")
          )).scalars().all()
      assert len(rows) == 1
      assert rows[0].repo_full_name is None
  ```

- [ ] **Step 2: Run the tests and see them pass (no implementation change needed).**
  Command:
  ```
  python -m pytest tests/test_trace_service.py -q
  ```
  Expected: 4 passed. The upsert logic is already in `_find_existing` from Task 4; these tests lock both the repo-scoped and standalone-scoped key behavior. If either fails, fix `_find_existing` in `trace_service.py` before continuing.

- [ ] **Step 3: Commit.**
  ```
  git add webapp/backend/tests/test_trace_service.py
  git commit -m "$(cat <<'EOF'
  Test repo and standalone session-id upsert in trace_service

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: Rewire `ingest.py` to call `create_or_update_trace`

**Files:**
- `webapp/backend/app/api/ingest.py`

- [ ] **Step 1: Confirm the existing ingest tests pass before the change (baseline).**
  Command:
  ```
  python -m pytest tests/test_ingest.py tests/test_e2e.py -q
  ```
  Expected: all pass (baseline — no failures). Record the count; it must not regress.

- [ ] **Step 2: Replace the inline blob-write + upsert block in `ingest.py` with a service call.**
  In `webapp/backend/app/api/ingest.py`, delete the entire block from the comment `# Upsert: a re-upload carrying the same session_id ...` (line beginning `    # Upsert:`) through `    await session.commit()` — that is, every line from the `# Upsert:` comment down to and including the `await session.commit()` call, replacing it all with:
  ```python
      result = await create_or_update_trace(
          session=session,
          blob_store=blob_store,
          unpacked=unpacked,
          owner_login=user.login,
          platform=platform,
          plugin_version=plugin_version,
          session_id=x_vibeshub_session_id,
          redaction_count_client=redaction_count_client,
          repo_full_name=pr.repo_full_name,
          pr_number=pr.number,
          pr_url=pr.html_url,
          pr_title=pr.title,
          is_private=pr.repo_is_private,
      )
      await session.commit()
      trace = result.trace
      created = result.created
  ```

- [ ] **Step 3: Update the imports in `ingest.py`.**
  In `webapp/backend/app/api/ingest.py`, replace this import line:
  ```python
  from app.api.schemas import IngestResponse
  ```
  with:
  ```python
  from app.api.schemas import IngestResponse
  from app.api.trace_service import create_or_update_trace
  ```
  Then remove the now-unused imports — delete these three lines:
  ```python
  import json
  ```
  ```python
  from app.message_count import count_messages
  ```
  ```python
  from app.short_id import generate
  ```
  (`json`, `count_messages`, and `generate` are only used by the block just deleted; `select` is still used? No — `select` was only used by the deleted upsert query. Delete the import line `from sqlalchemy import select` as well.)

- [ ] **Step 4: Run the ingest and e2e suites and see them pass unchanged.**
  Command:
  ```
  python -m pytest tests/test_ingest.py tests/test_e2e.py -q
  ```
  Expected: same pass count as Step 1's baseline, 0 failed. In particular `test_ingest_upserts_trace_for_same_session`, `test_ingest_without_session_always_creates`, and `test_ingest_does_not_resurrect_a_deleted_trace` still pass — the service preserves today's repo-scoped upsert behavior.

- [ ] **Step 5: Run the full backend suite to catch any unused-import or wiring fallout.**
  Command:
  ```
  python -m pytest tests/ -q
  ```
  Expected: 0 failed.

- [ ] **Step 6: Commit.**
  ```
  git add webapp/backend/app/api/ingest.py
  git commit -m "$(cat <<'EOF'
  Rewire /api/ingest to call the shared trace_service

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: Standalone-private access — `_require_trace_access` owner branch

**Files:**
- `webapp/backend/app/api/traces.py`
- `webapp/backend/tests/test_standalone_access.py`

- [ ] **Step 1: Write failing access-matrix tests for a private standalone trace.**
  Append to `webapp/backend/tests/test_standalone_access.py`:
  ```python
  from sqlalchemy import select as _select

  from tests._auth_helpers import authed_cookies


  async def _seed_standalone_trace(
      client, *, owner_login: str, short_id: str, is_private: bool
  ):
      """Insert a standalone (no repo/PR) trace directly and write its blob."""
      from app.storage.models import Trace

      SessionLocal = client.app.state.session_maker
      async with SessionLocal() as session:
          trace = Trace(
              short_id=short_id,
              owner_login=owner_login,
              repo_full_name=None,
              pr_number=None,
              pr_url=None,
              pr_title=None,
              platform="claude-code",
              byte_size=10,
              message_count=1,
              is_private=is_private,
              blob_prefix=f"traces/{short_id}/",
              agents=[],
              agent_count=0,
          )
          session.add(trace)
          await session.commit()
      await client.app.state.blob_store.put(
          f"traces/{short_id}/main.jsonl", b'{"type":"user"}\n'
      )


  @pytest.mark.asyncio
  async def test_public_standalone_trace_visible_to_anonymous(client):
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="pubstand01",
          is_private=False,
      )
      resp = client.get("/api/traces/pubstand01")
      assert resp.status_code == 200
      assert resp.json()["repo_full_name"] is None


  @pytest.mark.asyncio
  async def test_private_standalone_trace_401_for_anonymous(client):
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="privstand1",
          is_private=True,
      )
      resp = client.get("/api/traces/privstand1")
      assert resp.status_code == 401
      assert resp.json()["detail"] == "auth_required"
      assert resp.headers["Cache-Control"] == "no-store"


  @pytest.mark.asyncio
  async def test_private_standalone_trace_404_for_non_owner(client):
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="privstand2",
          is_private=True,
      )
      cookies, _ = await authed_cookies(
          client, github_id=200, login="bob",
          token_scopes="repo,read:user,user:email",
      )
      resp = client.get("/api/traces/privstand2", cookies=cookies)
      assert resp.status_code == 404
      assert resp.json()["detail"] == "not_found"
      assert resp.headers["Cache-Control"] == "no-store"


  @pytest.mark.asyncio
  async def test_private_standalone_trace_200_for_owner(client):
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="privstand3",
          is_private=True,
      )
      cookies, _ = await authed_cookies(
          client, github_id=100, login="alice",
          token_scopes="read:user,user:email",
      )
      resp = client.get("/api/traces/privstand3", cookies=cookies)
      assert resp.status_code == 200
      assert resp.json()["is_private"] is True
      assert resp.headers["Cache-Control"] == "private, no-store"


  @pytest.mark.asyncio
  async def test_private_standalone_raw_gated_for_non_owner(client):
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="privstand4",
          is_private=True,
      )
      anon = client.get("/api/traces/privstand4/raw")
      assert anon.status_code == 401
      cookies, _ = await authed_cookies(
          client, github_id=200, login="bob",
          token_scopes="read:user,user:email",
      )
      resp = client.get("/api/traces/privstand4/raw", cookies=cookies)
      assert resp.status_code == 404


  @pytest.mark.asyncio
  async def test_private_standalone_raw_served_for_owner(client):
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="privstand5",
          is_private=True,
      )
      cookies, _ = await authed_cookies(
          client, github_id=100, login="alice",
          token_scopes="read:user,user:email",
      )
      resp = client.get("/api/traces/privstand5/raw", cookies=cookies)
      assert resp.status_code == 200
      assert resp.headers["Cache-Control"] == "private, no-store"
  ```

- [ ] **Step 2: Run the new tests and see them fail.**
  Command:
  ```
  python -m pytest tests/test_standalone_access.py -q
  ```
  Expected: `test_private_standalone_trace_404_for_non_owner`, `test_private_standalone_trace_200_for_owner`, `test_private_standalone_raw_gated_for_non_owner`, and `test_private_standalone_raw_served_for_owner` fail. With `repo_full_name=None`, the current `_require_trace_access` reaches `access.can_read(user.id, token, None)` — a non-owner with `repo` scope gets an unintended GitHub call (502 / wrong status), and a non-`repo`-scope owner gets `403 private_scope_required` instead of `200`. (The two anonymous/public tests should already pass.)

- [ ] **Step 3: Add the standalone owner-only branch to `_require_trace_access`.**
  In `webapp/backend/app/api/traces.py`, replace the entire body of `_require_trace_access` (everything after the docstring, from `if not trace.is_private:` to the end of the function) with:
  ```python
      if not trace.is_private:
          return
      no_store = {"Cache-Control": "no-store"}
      if user is None:
          raise HTTPException(
              status_code=401, detail="auth_required", headers=no_store
          )
      # Standalone trace (no repo association): owner-only. A signed-in
      # non-owner gets 404 (the trace's existence is not disclosed).
      if trace.repo_full_name is None:
          if trace.owner_login != user.github_login:
              raise HTTPException(
                  status_code=404, detail="not_found", headers=no_store
              )
          return
      # Repo-associated: live GitHub repo-read-access check (unchanged).
      if not has_repo_scope(user):
          raise HTTPException(
              status_code=403, detail="private_scope_required", headers=no_store
          )
      token = _viewer_token(user, settings)
      if token is None:
          raise HTTPException(
              status_code=403, detail="private_scope_required", headers=no_store
          )
      try:
          allowed = await access.can_read(
              user.id, token, trace.repo_full_name
          )
      except RepoAccessError:
          raise HTTPException(
              status_code=502, detail="github_upstream_error", headers=no_store
          )
      if not allowed:
          raise HTTPException(
              status_code=404, detail="not_found", headers=no_store
          )
  ```

- [ ] **Step 4: Update the `_require_trace_access` docstring to describe the standalone branch.**
  In `webapp/backend/app/api/traces.py`, replace the `_require_trace_access` docstring (the triple-quoted block directly under the `def`) with:
  ```python
      """Raise the appropriate HTTPException if a viewer may not see `trace`.

      Public traces pass unconditionally. For a private trace:

      - **Standalone** (`repo_full_name` is None): owner-only. Anonymous →
        401 `auth_required`; signed-in non-owner → 404 `not_found`; owner →
        allowed.
      - **Repo-associated**: anonymous → 401; logged in without `repo` scope
        → 403; GitHub says no repo read access → 404; GitHub upstream error
        while checking → 502 (RepoAccessError).

      Every gated error response carries `Cache-Control: no-store` so a shared
      proxy cannot cache a stale 401/403/404/502 for a viewer whose access
      later changes.
      """
  ```

- [ ] **Step 5: Run the standalone-access suite and see it pass.**
  Command:
  ```
  python -m pytest tests/test_standalone_access.py -q
  ```
  Expected: all tests pass (7 passed — the schema test plus the six access tests).

- [ ] **Step 6: Run the existing private-trace suite to confirm no regression.**
  Command:
  ```
  python -m pytest tests/test_private_traces.py -q
  ```
  Expected: 0 failed — repo-associated private traces still use the live `RepoAccessChecker` path.

- [ ] **Step 7: Commit.**
  ```
  git add webapp/backend/app/api/traces.py webapp/backend/tests/test_standalone_access.py
  git commit -m "$(cat <<'EOF'
  Gate private standalone traces to their owner

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9: `_filter_visible` / `_can_view_repo` — standalone-private rows

**Files:**
- `webapp/backend/app/api/traces.py`
- `webapp/backend/tests/test_standalone_access.py`

- [ ] **Step 1: Write failing tests for `_filter_visible` on standalone-private rows.**
  Append to `webapp/backend/tests/test_standalone_access.py`:
  ```python
  @pytest.mark.asyncio
  async def test_user_overview_hides_private_standalone_from_anonymous(client):
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="ovstandpub",
          is_private=False,
      )
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="ovstandprv",
          is_private=True,
      )
      resp = client.get("/api/users/alice")
      assert resp.status_code == 200
      ids = {t["short_id"] for t in resp.json()["traces"]}
      assert ids == {"ovstandpub"}


  @pytest.mark.asyncio
  async def test_user_overview_hides_private_standalone_from_non_owner(client):
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="ovstandprv2",
          is_private=True,
      )
      cookies, _ = await authed_cookies(
          client, github_id=200, login="bob",
          token_scopes="repo,read:user,user:email",
      )
      resp = client.get("/api/users/alice", cookies=cookies)
      assert resp.status_code == 200
      assert resp.json()["traces"] == []


  @pytest.mark.asyncio
  async def test_user_overview_shows_private_standalone_to_owner(client):
      await _seed_standalone_trace(
          client, owner_login="alice", short_id="ovstandprv3",
          is_private=True,
      )
      cookies, _ = await authed_cookies(
          client, github_id=100, login="alice",
          token_scopes="read:user,user:email",
      )
      resp = client.get("/api/users/alice", cookies=cookies)
      assert resp.status_code == 200
      ids = {t["short_id"] for t in resp.json()["traces"]}
      assert ids == {"ovstandprv3"}
  ```

- [ ] **Step 2: Run the new tests and see them fail.**
  Command:
  ```
  python -m pytest tests/test_standalone_access.py -k standalone_from_non_owner -q
  python -m pytest tests/test_standalone_access.py -k shows_private_standalone_to_owner -q
  ```
  Expected: both fail. Current `_filter_visible` builds `private_repos = {t.repo_full_name for t in rows if t.is_private}` — for a standalone-private row that set contains `None`, and `_can_view_repo` is then called with `repo_full_name=None`, so a standalone-private trace is treated as a repo trace and the owner cannot see their own row while a non-owner's visibility hinges on a bogus GitHub call. (`test_user_overview_hides_private_standalone_from_anonymous` may already pass since anonymous fails `_can_view_repo`.)

- [ ] **Step 3: Rework `_filter_visible` to split standalone-private from repo-private rows.**
  In `webapp/backend/app/api/traces.py`, replace the entire body of `_filter_visible` (everything after its docstring) with:
  ```python
      def _row_visible(t: Trace, repo_visible: set[str]) -> bool:
          if not t.is_private:
              return True
          if t.repo_full_name is None:
              # Standalone-private: visible only to its owner.
              return user is not None and t.owner_login == user.github_login
          return t.repo_full_name in repo_visible

      # Repo-associated private rows share one access decision per repo.
      private_repos = {
          t.repo_full_name
          for t in rows
          if t.is_private and t.repo_full_name is not None
      }
      repo_visible: set[str] = set()
      for repo in private_repos:
          if await _can_view_repo(repo, user, settings, access):
              repo_visible.add(repo)
      return [t for t in rows if _row_visible(t, repo_visible)]
  ```

- [ ] **Step 4: Update the `_filter_visible` docstring.**
  In `webapp/backend/app/api/traces.py`, replace the `_filter_visible` docstring with:
  ```python
      """Drop private traces the viewer may not see; public rows always pass.

      A repo-associated private row is gated on the viewer's GitHub read
      access to its repo — checked once per distinct private repo. A
      standalone-private row (no repo) is visible only to its `owner_login`.
      """
  ```

- [ ] **Step 5: Run the standalone-access suite and see it pass.**
  Command:
  ```
  python -m pytest tests/test_standalone_access.py -q
  ```
  Expected: all pass (10 passed — schema + 6 access + 3 filter tests).

- [ ] **Step 6: Run the trace-listing and private-trace suites to confirm no regression.**
  Command:
  ```
  python -m pytest tests/test_traces.py tests/test_private_traces.py -q
  ```
  Expected: 0 failed — repo-associated rows still filter exactly as before (`_can_view_repo` is unchanged; the `repo_full_name is not None` guard means repo rows hit the same code path).

- [ ] **Step 7: Commit.**
  ```
  git add webapp/backend/app/api/traces.py webapp/backend/tests/test_standalone_access.py
  git commit -m "$(cat <<'EOF'
  Filter standalone-private traces to their owner in listings

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire backend test suite.**
  Command (from `webapp/backend/`):
  ```
  python -m pytest tests/ -q
  ```
  Expected: 0 failed. The collected count is the prior baseline (182) plus the tests added by this plan: `test_models.py` (+1), `test_migration_repo_pr_nullable.py` (+1), `test_standalone_access.py` (+10), `test_trace_service.py` (+4) — 198 total, all passing.

- [ ] **Step 2: Confirm a single Alembic head.**
  Command:
  ```
  python -m alembic heads
  ```
  Expected: `3a1f9c2b5e07 (head)` — exactly one head.

- [ ] **Step 3: Final commit if the verification surfaced any fix.**
  If Steps 1-2 required any change, commit it:
  ```
  git add -A
  git commit -m "$(cat <<'EOF'
  Fix fallout from standalone-trace Phase 1 verification

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```
  If nothing changed, skip this step — Phase 1 is complete.
