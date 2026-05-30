"""add title to traces

Revision ID: c1a2b3d4e5f6
Revises: b8d3f1a02c4e
Create Date: 2026-05-29 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1a2b3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "b8d3f1a02c4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the nullable `title` column to `traces`.

    An owner-supplied display title; NULL for all existing rows (the client
    falls back to the derived/AI title). On Postgres this is a plain
    ALTER TABLE; on SQLite we recreate the table via batch mode, matching the
    existing migrations in this project.
    """
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.add_column(
            "traces",
            sa.Column("title", sa.Text(), nullable=True),
        )
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.add_column(sa.Column("title", sa.Text(), nullable=True))


def downgrade() -> None:
    """Reverse of `upgrade`: drop the `title` column."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_column("traces", "title")
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.drop_column("title")
