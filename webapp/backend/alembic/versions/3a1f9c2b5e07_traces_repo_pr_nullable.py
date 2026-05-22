"""traces repo/pr columns nullable

Revision ID: 3a1f9c2b5e07
Revises: 7f3c1a9b2d4e
Create Date: 2026-05-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3a1f9c2b5e07"
down_revision: Union[str, Sequence[str], None] = "7f3c1a9b2d4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Relax `repo_full_name`, `pr_number`, `pr_url` to nullable so a
    standalone trace (no PR/repo) can be stored.

    Existing rows all populate the three columns, so they are untouched —
    this only widens the column constraint. On Postgres a native
    ALTER TABLE ... ALTER COLUMN DROP NOT NULL suffices. SQLite has no
    ALTER COLUMN, so we recreate the table via batch mode. The indexes on
    `repo_full_name` and `pr_number` are preserved.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.alter_column("traces", "repo_full_name", nullable=True)
        op.alter_column("traces", "pr_number", nullable=True)
        op.alter_column("traces", "pr_url", nullable=True)
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.alter_column(
                "repo_full_name",
                existing_type=sa.String(length=255),
                nullable=True,
            )
            batch_op.alter_column(
                "pr_number",
                existing_type=sa.Integer(),
                nullable=True,
            )
            batch_op.alter_column(
                "pr_url",
                existing_type=sa.String(length=512),
                nullable=True,
            )


def downgrade() -> None:
    """Re-tighten the three columns to NOT NULL.

    This will fail if any standalone (NULL repo/PR) rows exist — that is
    intentional, since a NOT NULL column cannot hold them.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.alter_column("traces", "repo_full_name", nullable=False)
        op.alter_column("traces", "pr_number", nullable=False)
        op.alter_column("traces", "pr_url", nullable=False)
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.alter_column(
                "repo_full_name",
                existing_type=sa.String(length=255),
                nullable=False,
            )
            batch_op.alter_column(
                "pr_number",
                existing_type=sa.Integer(),
                nullable=False,
            )
            batch_op.alter_column(
                "pr_url",
                existing_type=sa.String(length=512),
                nullable=False,
            )
