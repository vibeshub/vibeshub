"""traces owner_login nullable + claim_token_hash

Revision ID: d2e4f6a8c0b1
Revises: c1a2b3d4e5f6
Create Date: 2026-05-29 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2e4f6a8c0b1"
down_revision: Union[str, Sequence[str], None] = "c1a2b3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Allow anonymous (no-login) uploads: relax `owner_login` to nullable
    and add the nullable `claim_token_hash` column.

    An anonymous upload has no uploader (`owner_login` NULL) and carries a
    one-time claim token whose sha256 hex is stored in `claim_token_hash`;
    claiming the trace sets `owner_login` and clears the hash. Existing rows
    all populate `owner_login`, so they are untouched. On Postgres these are
    native ALTER TABLE statements; SQLite has no ALTER COLUMN, so we recreate
    the table via batch mode. The index on `owner_login` is preserved.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.alter_column("traces", "owner_login", nullable=True)
        op.add_column(
            "traces",
            sa.Column("claim_token_hash", sa.String(length=64), nullable=True),
        )
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.alter_column(
                "owner_login",
                existing_type=sa.String(length=64),
                nullable=True,
            )
            batch_op.add_column(
                sa.Column(
                    "claim_token_hash", sa.String(length=64), nullable=True
                )
            )


def downgrade() -> None:
    """Reverse of `upgrade`: drop `claim_token_hash` and re-tighten
    `owner_login` to NOT NULL.

    The re-tighten will fail if any anonymous (NULL owner_login) rows exist —
    that is intentional, since a NOT NULL column cannot hold them.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.drop_column("traces", "claim_token_hash")
        op.alter_column("traces", "owner_login", nullable=False)
    else:
        with op.batch_alter_table("traces", recreate="always") as batch_op:
            batch_op.drop_column("claim_token_hash")
            batch_op.alter_column(
                "owner_login",
                existing_type=sa.String(length=64),
                nullable=False,
            )
