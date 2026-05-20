"""One-time migration: recompute ``Trace.message_count`` and the per-agent
``message_count`` in ``Trace.agents`` from blob contents.

Legacy rows store ``len(jsonl.splitlines())`` — the raw transcript record
count, which overcounts tool-result lines, system records, snapshots,
progress hooks, and streamed assistant lines. This script replaces those
values with ``count_messages()`` (rendered messages: assistant text blocks
+ tool calls), matching what the trace view shows and what fresh ingests
now store.

Idempotent — recomputing is deterministic, so re-running only touches rows
whose stored count is still wrong (none, on a second pass).

Configuration is loaded from ``deploy/azure/.env`` (relative to the repo
root) so the script targets the production database and blob container
without extra environment setup. Real environment variables, if set, take
precedence over the file.

Run::

    python -m scripts.recount_messages [--dry-run] [--limit N]
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.message_count import count_messages
from app.storage.blob import BlobStore
from app.storage.models import Trace

# scripts/ -> backend/ -> webapp/ -> repo root -> deploy/azure/.env
ENV_FILE = Path(__file__).resolve().parents[3] / "deploy" / "azure" / ".env"


def load_env_file(path: Path) -> int:
    """Parse a ``KEY=VALUE`` .env file and apply it to ``os.environ``.

    Blank lines and ``#`` comments are skipped. Surrounding quotes are
    stripped. Variables already present in the real environment win, so an
    operator can still override (e.g.) the database URL on the command line.
    Returns the number of variables applied from the file.
    """
    if not path.exists():
        raise FileNotFoundError(f"env file not found: {path}")

    applied = 0
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key or key in os.environ:
            continue
        os.environ[key] = value
        applied += 1
    return applied


@dataclass
class RecountSummary:
    updated: int = 0
    unchanged: int = 0
    would_update: int = 0
    failed: int = 0
    changes: list[str] = field(default_factory=list)


def _main_blob_key(trace: Trace) -> str:
    """Blob key for the trace's main transcript, across both storage layouts."""
    if trace.blob_prefix is not None:
        return f"{trace.blob_prefix}main.jsonl"
    assert trace.blob_path, (
        f"trace {trace.short_id} has neither blob_prefix nor blob_path"
    )
    return trace.blob_path


async def recount_one(blob_store: BlobStore, trace: Trace) -> bool:
    """Recompute and apply message counts for one trace.

    Mutates ``trace`` in place (caller is responsible for committing).
    Returns True if any stored count changed, False if already correct.
    """
    main_bytes = await blob_store.get(_main_blob_key(trace))
    new_main = count_messages(main_bytes)

    changed = new_main != trace.message_count

    new_agents: list[dict] | None = None
    if trace.agents:
        new_agents = []
        for agent in trace.agents:
            agent_id = agent["agent_id"]
            agent_bytes = await blob_store.get(
                f"{trace.blob_prefix}agents/{agent_id}.jsonl"
            )
            recounted = dict(agent)
            recounted["message_count"] = count_messages(agent_bytes)
            if recounted["message_count"] != agent.get("message_count"):
                changed = True
            new_agents.append(recounted)

    if not changed:
        return False

    trace.message_count = new_main
    if new_agents is not None:
        # `agents` is a plain JSON column (not MutableList) — reassign so the
        # ORM flags the attribute dirty.
        trace.agents = new_agents
    return True


async def run_recount(
    session: AsyncSession,
    blob_store: BlobStore,
    *,
    dry_run: bool = False,
    limit: int | None = None,
) -> RecountSummary:
    summary = RecountSummary()

    stmt = (
        select(Trace)
        .where(Trace.deleted_at.is_(None))
        .order_by(Trace.created_at)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    for trace in rows:
        old_main = trace.message_count
        try:
            changed = await recount_one(blob_store, trace)
        except Exception as e:
            summary.failed += 1
            print(
                f"FAILED {trace.short_id}: {type(e).__name__}: {e} "
                f"(blob_prefix={trace.blob_prefix!r}, blob_path={trace.blob_path!r})"
            )
            continue

        if not changed:
            summary.unchanged += 1
            continue

        summary.changes.append(
            f"  {trace.short_id}: message_count {old_main} -> {trace.message_count}"
        )
        if dry_run:
            summary.would_update += 1
        else:
            summary.updated += 1

    if dry_run:
        await session.rollback()
    else:
        await session.commit()

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report planned changes without writing.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N rows.",
    )
    args = parser.parse_args()

    applied = load_env_file(ENV_FILE)
    print(f"DEBUG loaded {applied} var(s) from {ENV_FILE}")

    async def _run() -> None:
        # Construct a session + blob store outside the FastAPI request
        # context using the same factories app/deps.py wires up.
        from app.settings import get_settings
        from app.storage.blob import LocalDirBlobStore, make_azure_blob_store
        from app.storage.db import engine_for, session_maker_for

        settings = get_settings()
        engine = engine_for(settings.database_url)
        session_factory = session_maker_for(engine)
        if settings.azure_blob_container:
            blob_store: BlobStore = make_azure_blob_store(settings)
            print(
                f"DEBUG blob backend: AzureBlobStore "
                f"(container={settings.azure_blob_container!r})"
            )
        else:
            blob_store = LocalDirBlobStore(settings.blob_dir)
            print(
                f"DEBUG blob backend: LocalDirBlobStore (dir={settings.blob_dir}) "
                f"-- VIBESHUB_AZURE_BLOB_CONTAINER is unset; reading blobs from "
                f"local disk, not Azure"
            )
        print(f"DEBUG database_url host: {settings.database_url.rsplit('@', 1)[-1]}")

        try:
            async with session_factory() as session:
                summary = await run_recount(
                    session,
                    blob_store,
                    dry_run=args.dry_run,
                    limit=args.limit,
                )
        finally:
            await engine.dispose()

        if summary.changes:
            print("changes:" if not args.dry_run else "would change:")
            for line in summary.changes:
                print(line)
        print(f"updated:       {summary.updated}")
        print(f"unchanged:     {summary.unchanged}")
        print(f"would_update:  {summary.would_update}")
        print(f"failed:        {summary.failed}")
        if summary.failed:
            sys.exit(1)

    asyncio.run(_run())


if __name__ == "__main__":
    main()
