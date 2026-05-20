"""One-time migration: relocate legacy ``traces/<sid>.jsonl`` blobs into the
v2 prefix layout ``traces/<sid>/main.jsonl``. Sets ``blob_prefix``, nulls
``blob_path``, sets ``agents=[]`` and ``agent_count=0``. Idempotent —
re-running skips rows already in v2 layout.

Old subagent data is NOT backfilled. Pre-existing traces ship with
``agents=[]`` permanently; the frontend's existing dispatch-prompt-and-summary
rendering covers their UX without subagent expansion.

Two-pass design: ``run_migration`` performs all blob-put + DB updates first,
then commits the DB, then deletes the legacy blobs. If the script crashes
between the put and the commit, the new blob is intact and re-running is a
no-op (idempotent on ``blob_prefix is None``); the legacy blob is left
behind for the next run to clean up.

Run::

    python -m scripts.migrate_to_v2_storage [--dry-run] [--limit N]
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.storage.blob import BlobStore
from app.storage.models import Trace


@dataclass
class MigrationSummary:
    migrated: int = 0
    already_migrated: int = 0
    would_migrate: int = 0
    failed: int = 0


async def migrate_one(
    session: AsyncSession,
    blob_store: BlobStore,
    trace: Trace,
) -> bool:
    """Move one trace's blob into the v2 layout and update its row.

    Returns True if migration was performed, False if the row was already
    in v2 layout (no-op).
    """
    if trace.blob_prefix is not None:
        return False
    assert trace.blob_path, (
        f"trace {trace.short_id} has neither blob_prefix nor blob_path"
    )

    sid = trace.short_id
    new_key = f"traces/{sid}/main.jsonl"
    data = await blob_store.get(trace.blob_path)
    await blob_store.put(new_key, data)

    trace.blob_prefix = f"traces/{sid}/"
    trace.blob_path = None
    trace.agents = []
    trace.agent_count = 0
    return True


async def cleanup_legacy_blob(blob_store: BlobStore, short_id: str) -> bool:
    """Delete the legacy ``traces/<sid>.jsonl`` blob after a successful migrate.

    Returns True if a blob was deleted, False otherwise. Swallows all errors
    (blob already gone, transient backend failure) so a single bad row
    cannot abort cleanup for the rest of the batch — the DB row is already
    in v2 layout at this point, the legacy blob is just orphaned and can be
    cleaned up manually later.
    """
    try:
        await blob_store.delete(f"traces/{short_id}.jsonl")
        return True
    except FileNotFoundError:
        return False
    except Exception as e:
        print(f"WARN cleanup failed for {short_id}: {e}", file=sys.stderr)
        return False


async def run_migration(
    session: AsyncSession,
    blob_store: BlobStore,
    *,
    dry_run: bool = False,
    limit: int | None = None,
) -> MigrationSummary:
    summary = MigrationSummary()

    stmt = select(Trace).where(Trace.deleted_at.is_(None)).order_by(Trace.created_at)
    if limit is not None:
        stmt = stmt.limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    migrated_short_ids: list[str] = []
    for trace in rows:
        if trace.blob_prefix is not None:
            summary.already_migrated += 1
            continue
        if dry_run:
            summary.would_migrate += 1
            continue
        try:
            performed = await migrate_one(session, blob_store, trace)
            if performed:
                summary.migrated += 1
                migrated_short_ids.append(trace.short_id)
        except Exception as e:
            summary.failed += 1
            print(
                f"FAILED {trace.short_id}: {type(e).__name__}: {e} "
                f"(blob_path={trace.blob_path!r}, blob_prefix={trace.blob_prefix!r})"
            )

    if dry_run:
        await session.rollback()
        return summary

    await session.commit()

    # Pass 2: delete legacy blobs only after the DB commit succeeds. A crash
    # before this point leaves the legacy blob intact so re-running picks
    # the work back up.
    for sid in migrated_short_ids:
        await cleanup_legacy_blob(blob_store, sid)

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report planned work without writing.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N rows.",
    )
    args = parser.parse_args()

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
                summary = await run_migration(
                    session,
                    blob_store,
                    dry_run=args.dry_run,
                    limit=args.limit,
                )
        finally:
            await engine.dispose()

        print(f"migrated:         {summary.migrated}")
        print(f"already_migrated: {summary.already_migrated}")
        print(f"would_migrate:    {summary.would_migrate}")
        print(f"failed:           {summary.failed}")

    asyncio.run(_run())


if __name__ == "__main__":
    main()
