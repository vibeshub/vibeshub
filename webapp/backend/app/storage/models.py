from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Trace(Base):
    __tablename__ = "traces"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    short_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)

    owner_login: Mapped[str] = mapped_column(String(64), index=True)
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
    pr_title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    platform: Mapped[str] = mapped_column(String(32))
    plugin_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    byte_size: Mapped[int] = mapped_column(BigInteger)
    message_count: Mapped[int] = mapped_column(Integer)
    redaction_count_client: Mapped[int] = mapped_column(Integer, default=0)
    redaction_count_server: Mapped[int] = mapped_column(Integer, default=0)

    # Snapshotted at ingest from the PR's repo visibility. Private traces are
    # gated behind a viewer's GitHub repo-read access; see app/api/traces.py.
    is_private: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # Legacy: one of blob_path / blob_prefix is non-null per row.
    # v1 ingests set blob_path; v2 ingests (post-2026-05-19) set blob_prefix.
    blob_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    blob_prefix: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # "terminal" when the trace was reconstructed from a .txt export (its raw
    # bytes are archived at {blob_prefix}source_export.txt); NULL otherwise.
    source_format: Mapped[Optional[str]] = mapped_column(
        String(32), nullable=True
    )

    # Subagent summaries surfaced via TraceSummary. Stored as JSON list of
    # AgentSummary dicts (see app/api/schemas.py). NULL for legacy rows
    # pre-migration; empty list [] for rows migrated by
    # scripts/migrate_to_v2_storage.py.
    agents: Mapped[Optional[list[dict]]] = mapped_column(JSON, nullable=True)
    agent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # `github_id` is the immutable identity. github_login can be renamed; we
    # upsert on github_id and refresh github_login on each login.
    github_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    github_login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Fernet ciphertext of the OAuth access token. Always set on insert.
    encrypted_access_token: Mapped[str] = mapped_column(Text)
    # Comma-separated OAuth scopes the token was issued with. Plaintext.
    token_scopes: Mapped[str] = mapped_column(String(255), default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    # Opaque session id from `secrets.token_urlsafe(32)` (43 chars). String(64)
    # leaves room for a future `v1.<id>` prefix without another migration.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
