"""add digest columns to traces and agent_run table

Revision ID: e1f8a2b9c073
Revises: d2e4f6a8c0b1
Create Date: 2026-06-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1f8a2b9c073"
down_revision: Union[str, Sequence[str], None] = "d2e4f6a8c0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add digest_json + digest_input_hash on traces and create agent_run."""
    op.add_column(
        "traces",
        sa.Column("digest_json", sa.JSON(), nullable=True),
    )
    op.add_column(
        "traces",
        sa.Column("digest_input_hash", sa.String(length=64), nullable=True),
    )
    op.create_table(
        "agent_run",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("agent_name", sa.String(length=64), nullable=False),
        sa.Column("trace_id", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("extra", sa.JSON(), nullable=True),
    )
    op.create_index(
        "ix_agent_run_agent_name", "agent_run", ["agent_name"]
    )
    op.create_index(
        "ix_agent_run_trace_id", "agent_run", ["trace_id"]
    )
    op.create_index(
        "ix_agent_run_created_at", "agent_run", ["created_at"]
    )
    op.create_index(
        "ix_agent_run_outcome", "agent_run", ["outcome"]
    )


def downgrade() -> None:
    """Drop digest columns and agent_run."""
    op.drop_index("ix_agent_run_outcome", table_name="agent_run")
    op.drop_index("ix_agent_run_created_at", table_name="agent_run")
    op.drop_index("ix_agent_run_trace_id", table_name="agent_run")
    op.drop_index("ix_agent_run_agent_name", table_name="agent_run")
    op.drop_table("agent_run")
    op.drop_column("traces", "digest_input_hash")
    op.drop_column("traces", "digest_json")
