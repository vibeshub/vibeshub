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

    On Postgres, ALTER TABLE adds the columns and relaxes the NOT NULL on
    `blob_path` natively. On SQLite, `ALTER TABLE ... ALTER COLUMN` is not
    supported, so we use `batch_alter_table(recreate="always")` to recreate
    the table with the new schema in place.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.add_column(
            "traces",
            sa.Column("agents", sa.JSON(), nullable=True),
        )
        op.add_column(
            "traces",
            sa.Column(
                "agent_count", sa.Integer(), nullable=False, server_default="0"
            ),
        )
        op.add_column(
            "traces",
            sa.Column("blob_prefix", sa.String(length=512), nullable=True),
        )
        op.alter_column("traces", "blob_path", nullable=True)
    else:
        # SQLite — recreate the table via batch mode so the new columns are
        # added and `blob_path` is reliably relaxed to nullable in a single
        # rebuild. `recreate="always"` forces the rebuild even though
        # batch_op would otherwise only fall back to it for unsupported ops.
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.add_column(
                sa.Column("agents", sa.JSON(), nullable=True)
            )
            batch_op.add_column(
                sa.Column(
                    "agent_count",
                    sa.Integer(),
                    nullable=False,
                    server_default="0",
                )
            )
            batch_op.add_column(
                sa.Column("blob_prefix", sa.String(length=512), nullable=True)
            )
            batch_op.alter_column(
                "blob_path",
                existing_type=sa.String(length=512),
                nullable=True,
            )


def downgrade() -> None:
    """Downgrade schema.

    Reverse of `upgrade`: re-tighten `blob_path` to NOT NULL and drop the
    three new columns. Same dialect branching as upgrade — Postgres uses
    native ALTER TABLE; SQLite recreates the table via batch mode.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.alter_column("traces", "blob_path", nullable=False)
        op.drop_column("traces", "blob_prefix")
        op.drop_column("traces", "agent_count")
        op.drop_column("traces", "agents")
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.alter_column(
                "blob_path",
                existing_type=sa.String(length=512),
                nullable=False,
            )
            batch_op.drop_column("blob_prefix")
            batch_op.drop_column("agent_count")
            batch_op.drop_column("agents")
