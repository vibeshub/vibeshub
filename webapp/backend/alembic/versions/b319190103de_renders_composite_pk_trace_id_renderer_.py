"""renders: composite PK (trace_id, renderer_version)

Revision ID: b319190103de
Revises: 9e191b25d172
Create Date: 2026-05-09 00:14:23.865615

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b319190103de'
down_revision: Union[str, Sequence[str], None] = '9e191b25d172'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _renders_table(*pk_cols: str) -> sa.Table:
    """Build a Table mirroring the renders schema with the given PK columns.

    Used as `copy_from` for batch_alter_table on SQLite so SQLAlchemy's
    table-recreate machinery starts from a definition that already matches
    the desired post-op PK (avoiding a SAWarning about mismatched PKs).
    """
    meta = sa.MetaData()
    return sa.Table(
        "renders",
        meta,
        sa.Column("trace_id", sa.Uuid(), nullable=False),
        sa.Column("renderer_version", sa.String(length=64), nullable=False),
        sa.Column("html", sa.Text(), nullable=False),
        sa.Column("rendered_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["trace_id"], ["traces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint(*pk_cols),
    )


def upgrade() -> None:
    """Upgrade schema.

    Replace single-column PK on renders.trace_id with composite PK on
    (trace_id, renderer_version) so multiple renderer versions can coexist
    for the same trace (version-keyed cache).

    On Postgres, ALTER TABLE swaps the PK natively. On SQLite,
    batch_alter_table recreates the table with the new PK in place.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.drop_constraint("renders_pkey", "renders", type_="primary")
        op.create_primary_key(
            "renders_pkey", "renders", ["trace_id", "renderer_version"]
        )
    else:
        # SQLite — recreate the table via batch mode with the new PK.
        # `copy_from` describes the *current* table so SQLAlchemy doesn't
        # complain about a PK mismatch between reflected and target schemas;
        # `create_primary_key` then overrides the PK on the recreated table.
        with op.batch_alter_table(
            "renders",
            recreate="always",
            copy_from=_renders_table("trace_id"),
        ) as batch_op:
            batch_op.create_primary_key(
                "pk_renders", ["trace_id", "renderer_version"]
            )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.drop_constraint("renders_pkey", "renders", type_="primary")
        op.create_primary_key("renders_pkey", "renders", ["trace_id"])
    else:
        with op.batch_alter_table(
            "renders",
            recreate="always",
            copy_from=_renders_table("trace_id", "renderer_version"),
        ) as batch_op:
            batch_op.create_primary_key("pk_renders", ["trace_id"])
