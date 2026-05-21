"""add is_private to traces

Revision ID: 7f3c1a9b2d4e
Revises: def14788849e
Create Date: 2026-05-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7f3c1a9b2d4e"
down_revision: Union[str, Sequence[str], None] = "def14788849e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add `is_private` to traces, defaulting existing rows to public.

    A single ADD COLUMN with a server_default works natively on both
    Postgres and SQLite (3.35+), so no batch/dialect branching is needed.
    """
    op.add_column(
        "traces",
        sa.Column(
            "is_private",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    """Drop the `is_private` column."""
    op.drop_column("traces", "is_private")
