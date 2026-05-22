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
