"""add source_format to traces

Revision ID: b8d3f1a02c4e
Revises: a7e2c4f81b39
Create Date: 2026-05-29 08:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8d3f1a02c4e"
down_revision: Union[str, Sequence[str], None] = "a7e2c4f81b39"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the nullable `source_format` column to `traces`.

    "terminal" marks a trace reconstructed from a Claude Code .txt export; NULL
    for all existing rows and ordinary .jsonl uploads. On Postgres this is a
    plain ALTER TABLE; on SQLite (which can't ALTER ADD COLUMN with all options
    reliably under Alembic) we recreate the table via batch mode, matching the
    existing migrations in this project.
    """
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.add_column(
            "traces",
            sa.Column("source_format", sa.String(length=32), nullable=True),
        )
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.add_column(
                sa.Column("source_format", sa.String(length=32), nullable=True)
            )


def downgrade() -> None:
    """Reverse of `upgrade`: drop the `source_format` column."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_column("traces", "source_format")
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.drop_column("source_format")
