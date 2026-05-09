from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Trace(Base):
    __tablename__ = "traces"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    short_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)

    owner_login: Mapped[str] = mapped_column(String(64), index=True)
    repo_full_name: Mapped[str] = mapped_column(String(255), index=True)
    pr_number: Mapped[int] = mapped_column(Integer, index=True)
    pr_url: Mapped[str] = mapped_column(String(512))
    pr_title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    platform: Mapped[str] = mapped_column(String(32))
    plugin_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    byte_size: Mapped[int] = mapped_column(BigInteger)
    message_count: Mapped[int] = mapped_column(Integer)
    redaction_count_client: Mapped[int] = mapped_column(Integer, default=0)
    redaction_count_server: Mapped[int] = mapped_column(Integer, default=0)

    blob_path: Mapped[str] = mapped_column(String(512))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    render: Mapped[Optional["Render"]] = relationship(back_populates="trace", uselist=False)


class Render(Base):
    __tablename__ = "renders"

    trace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("traces.id", ondelete="CASCADE"), primary_key=True
    )
    html: Mapped[str] = mapped_column(Text)
    rendered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    renderer_version: Mapped[str] = mapped_column(String(64))

    trace: Mapped[Trace] = relationship(back_populates="render")
