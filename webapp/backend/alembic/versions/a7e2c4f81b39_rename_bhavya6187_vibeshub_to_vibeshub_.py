"""rename bhavya6187/vibeshub references to vibeshub/vibeshub

Revision ID: a7e2c4f81b39
Revises: 3a1f9c2b5e07
Create Date: 2026-05-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7e2c4f81b39"
down_revision: Union[str, Sequence[str], None] = "3a1f9c2b5e07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OLD_OWNER_LOWER = "bhavya6187"
NEW_OWNER = "vibeshub"
REPO = "vibeshub"


def upgrade() -> None:
    """Rewrite trace rows that reference the old `bhavya6187/vibeshub` repo
    to its new org-owned name `vibeshub/vibeshub` after the GitHub transfer.

    Repos are stored by string (not by GitHub's immutable numeric ID), so a
    transfer is not automatically reflected. GitHub's HTTP redirects keep
    API/web links working, but breadcrumbs and frontend route joins use the
    stored string and would show the obsolete owner. This is a one-shot
    data rewrite — schema is unchanged.

    `repo_full_name` is matched case-insensitively (via LOWER) since the
    casing on disk depends on what GitHub's API returned at ingest time.
    For `pr_url` we rewrite both the lowercased and canonical-cased owner
    prefix; SQL REPLACE is case-sensitive so the two forms are handled
    explicitly. Run this only AFTER the GitHub transfer is complete.
    """
    bind = op.get_bind()

    bind.execute(
        sa.text(
            "UPDATE traces SET repo_full_name = :new "
            "WHERE LOWER(repo_full_name) = :old"
        ),
        {
            "new": f"{NEW_OWNER}/{REPO}",
            "old": f"{OLD_OWNER_LOWER}/{REPO}",
        },
    )

    for old_owner in (OLD_OWNER_LOWER, "Bhavya6187"):
        old_prefix = f"github.com/{old_owner}/{REPO}/"
        new_prefix = f"github.com/{NEW_OWNER}/{REPO}/"
        bind.execute(
            sa.text(
                "UPDATE traces SET pr_url = REPLACE(pr_url, :old, :new) "
                "WHERE pr_url LIKE :pattern"
            ),
            {"old": old_prefix, "new": new_prefix, "pattern": f"%{old_prefix}%"},
        )


def downgrade() -> None:
    """Reverse the rewrite. Note this also catches any new traces uploaded
    against the new `vibeshub/vibeshub` name after the transfer — the
    downgrade is only fully safe before any post-transfer data exists.
    """
    bind = op.get_bind()

    bind.execute(
        sa.text(
            "UPDATE traces SET repo_full_name = :new "
            "WHERE LOWER(repo_full_name) = :old"
        ),
        {
            "new": f"{OLD_OWNER_LOWER}/{REPO}",
            "old": f"{NEW_OWNER}/{REPO}",
        },
    )

    old_prefix = f"github.com/{NEW_OWNER}/{REPO}/"
    new_prefix = f"github.com/{OLD_OWNER_LOWER}/{REPO}/"
    bind.execute(
        sa.text(
            "UPDATE traces SET pr_url = REPLACE(pr_url, :old, :new) "
            "WHERE pr_url LIKE :pattern"
        ),
        {"old": old_prefix, "new": new_prefix, "pattern": f"%{old_prefix}%"},
    )
