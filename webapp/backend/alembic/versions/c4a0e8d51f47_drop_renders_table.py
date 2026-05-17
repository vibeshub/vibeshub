"""drop renders table

Revision ID: c4a0e8d51f47
Revises: b319190103de
Create Date: 2026-05-17 10:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c4a0e8d51f47"
down_revision: Union[str, Sequence[str], None] = "b319190103de"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the renders cache table.

    The renders table held HTML output from claude-code-log, which has been
    replaced by an in-browser React viewer. The HTML is no longer produced
    server-side, so the table has no remaining purpose.
    """
    op.drop_table("renders")


def downgrade() -> None:
    """Recreate the renders table with the post-b319190103de schema
    (composite PK on trace_id + renderer_version)."""
    op.create_table(
        "renders",
        sa.Column("trace_id", sa.Uuid(), nullable=False),
        sa.Column("renderer_version", sa.String(length=64), nullable=False),
        sa.Column("html", sa.Text(), nullable=False),
        sa.Column("rendered_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["trace_id"], ["traces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("trace_id", "renderer_version"),
    )
