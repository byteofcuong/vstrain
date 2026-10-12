"""Bảng mẫu: sample và sample_sequence

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-12
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

INTERNAL_ID = "'S' || CASE WHEN id < 10000000 THEN lpad(id::text, 7, '0') ELSE id::text END"


def upgrade() -> None:
    op.create_table(
        "sample",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("internal_id", sa.String(20), sa.Computed(INTERNAL_ID, persisted=True), nullable=False),
        sa.Column("display_name", sa.String(300), nullable=False),
        sa.Column("pathogen", sa.String(40), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("accession", sa.String(40), nullable=True),
        sa.Column("collection_date_raw", sa.String(40), nullable=True),
        sa.Column("date_min", sa.Date(), nullable=True),
        sa.Column("date_max", sa.Date(), nullable=True),
        sa.Column("country", sa.String(100), nullable=True),
        sa.Column("division_raw", sa.String(200), nullable=True),
        sa.Column("location_raw", sa.String(200), nullable=True),
        sa.Column("admin_unit_code", sa.String(60), nullable=True),
        sa.Column("region_code", sa.String(60), nullable=True),
        sa.Column("geo_status", sa.String(20), nullable=False),
        sa.Column("host", sa.String(100), nullable=True),
        sa.Column("meta", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sample")),
        sa.UniqueConstraint("internal_id", name=op.f("uq_sample_internal_id")),
        sa.UniqueConstraint("accession", name=op.f("uq_sample_accession")),
        sa.ForeignKeyConstraint(
            ["admin_unit_code"], ["admin_unit.code"], name=op.f("fk_sample_admin_unit_code_admin_unit")
        ),
        sa.ForeignKeyConstraint(["region_code"], ["admin_unit.code"], name=op.f("fk_sample_region_code_admin_unit")),
        sa.CheckConstraint(
            "geo_status IN ('province', 'region', 'missing', 'unresolved', 'foreign')",
            name=op.f("ck_sample_geo_status_known"),
        ),
        sa.CheckConstraint(
            "(date_min IS NULL) = (date_max IS NULL) AND (date_min IS NULL OR date_min <= date_max)",
            name=op.f("ck_sample_date_range_valid"),
        ),
    )
    op.create_index(op.f("ix_sample_admin_unit_code"), "sample", ["admin_unit_code"])
    op.create_index(op.f("ix_sample_region_code"), "sample", ["region_code"])
    op.create_table(
        "sample_sequence",
        sa.Column("sample_id", sa.BigInteger(), nullable=False),
        sa.Column("sequence", sa.Text(), nullable=False),
        sa.Column("length", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.PrimaryKeyConstraint("sample_id", name=op.f("pk_sample_sequence")),
        sa.ForeignKeyConstraint(
            ["sample_id"], ["sample.id"], name=op.f("fk_sample_sequence_sample_id_sample"), ondelete="CASCADE"
        ),
    )


def downgrade() -> None:
    op.drop_table("sample_sequence")
    op.drop_table("sample")
