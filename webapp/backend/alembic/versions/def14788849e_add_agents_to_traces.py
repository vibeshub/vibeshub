"""add agents to traces

Revision ID: def14788849e
Revises: 380015a6acca
Create Date: 2026-05-19 15:58:42.994146

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "def14788849e"
down_revision: Union[str, Sequence[str], None] = "380015a6acca"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add columns to support multi-blob storage layout for subagent traces.

    `blob_prefix` supersedes `blob_path` for v2 ingests — exactly one of the
    two is non-null per row after the one-time migration script runs.
    `agents` is the JSON list of AgentSummary entries surfaced to the
    frontend; `agent_count` is denormalized for list views.
    """
    op.add_column(
        "traces",
        sa.Column("agents", sa.JSON(), nullable=True),
    )
    op.add_column(
        "traces",
        sa.Column("agent_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "traces",
        sa.Column("blob_prefix", sa.String(length=512), nullable=True),
    )
    op.alter_column("traces", "blob_path", nullable=True)


def downgrade() -> None:
    op.alter_column("traces", "blob_path", nullable=False)
    op.drop_column("traces", "blob_prefix")
    op.drop_column("traces", "agent_count")
    op.drop_column("traces", "agents")
