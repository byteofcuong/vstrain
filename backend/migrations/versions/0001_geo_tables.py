"""Bảng địa danh: admin_unit và place_alias

Revision ID: 0001
Revises:
Create Date: 2026-10-12
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_unit",
        sa.Column("code", sa.String(60), nullable=False),
        sa.Column("level", sa.String(20), nullable=False),
        sa.Column("unit_set", sa.String(10), nullable=True),
        sa.Column("name_vi", sa.String(100), nullable=False),
        sa.Column("name_en", sa.String(100), nullable=False),
        sa.Column("parent_code", sa.String(60), nullable=True),
        sa.Column("successor_code", sa.String(60), nullable=True),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_admin_unit")),
        sa.ForeignKeyConstraint(
            ["parent_code"], ["admin_unit.code"], name=op.f("fk_admin_unit_parent_code_admin_unit")
        ),
        sa.ForeignKeyConstraint(
            ["successor_code"], ["admin_unit.code"], name=op.f("fk_admin_unit_successor_code_admin_unit")
        ),
        sa.CheckConstraint("level IN ('macro_region', 'region', 'province')", name=op.f("ck_admin_unit_level_known")),
        sa.CheckConstraint(
            "(level = 'province') = (unit_set IS NOT NULL)", name=op.f("ck_admin_unit_only_provinces_have_a_set")
        ),
    )
    op.create_table(
        "place_alias",
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("unit_code", sa.String(60), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("example", sa.String(200), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_place_alias")),
        sa.ForeignKeyConstraint(
            ["unit_code"], ["admin_unit.code"], name=op.f("fk_place_alias_unit_code_admin_unit"), ondelete="CASCADE"
        ),
    )
    op.create_index(op.f("ix_place_alias_unit_code"), "place_alias", ["unit_code"])


def downgrade() -> None:
    op.drop_table("place_alias")
    op.drop_table("admin_unit")
