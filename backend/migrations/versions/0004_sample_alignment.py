"""Bảng sample_alignment: chuỗi đã gióng theo reference, mỗi mẫu một dòng

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-12
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sample_alignment",
        sa.Column("sample_id", sa.BigInteger(), nullable=False),
        sa.Column("lineage", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("aligned_sequence", sa.Text(), nullable=True),
        sa.Column("valid_nt", sa.Integer(), nullable=True),
        sa.Column("coverage", sa.Float(), nullable=True),
        sa.Column("substitutions", sa.Integer(), nullable=True),
        sa.Column("deletions", sa.Integer(), nullable=True),
        sa.Column("insertions", sa.Integer(), nullable=True),
        sa.Column("missing", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("sequence_sha256", sa.String(64), nullable=False),
        sa.Column("tool", sa.String(60), nullable=False),
        sa.Column("aligned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("sample_id", name=op.f("pk_sample_alignment")),
        sa.ForeignKeyConstraint(
            ["sample_id"], ["sample.id"], name=op.f("fk_sample_alignment_sample_id_sample"), ondelete="CASCADE"
        ),
        sa.CheckConstraint("status IN ('aligned', 'failed')", name=op.f("ck_sample_alignment_status_known")),
        sa.CheckConstraint(
            "(status = 'aligned') = (aligned_sequence IS NOT NULL)",
            name=op.f("ck_sample_alignment_aligned_has_sequence"),
        ),
    )
    op.create_index(op.f("ix_sample_alignment_lineage"), "sample_alignment", ["lineage"])


def downgrade() -> None:
    op.drop_table("sample_alignment")
