"""Bảng dataset_def, build và build_sample

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-12
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dataset_def",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("slug", sa.String(60), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("pathogen", sa.String(40), nullable=False),
        sa.Column("lineage", sa.String(40), nullable=False),
        sa.Column("max_samples", sa.Integer(), nullable=False),
        sa.Column("home_country", sa.String(100), server_default="Vietnam", nullable=False),
        sa.Column("min_context_share", sa.Float(), server_default=sa.text("0.25"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_dataset_def")),
        sa.UniqueConstraint("slug", name=op.f("uq_dataset_def_slug")),
    )
    op.create_table(
        "build",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("dataset_id", sa.BigInteger(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("is_current", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("path", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_build")),
        sa.ForeignKeyConstraint(
            ["dataset_id"], ["dataset_def.id"], name=op.f("fk_build_dataset_id_dataset_def"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["job_id"], ["job.id"], name=op.f("fk_build_job_id_job"), ondelete="SET NULL"),
        sa.CheckConstraint("status IN ('running', 'succeeded', 'failed')", name=op.f("ck_build_status_known")),
    )
    op.create_index(op.f("ix_build_dataset_id"), "build", ["dataset_id"])
    # Mỗi dataset chỉ có một build hiện hành: ràng buộc nằm ở DB, không dựa vào mã ứng dụng.
    op.create_index(
        "uq_build_current_per_dataset", "build", ["dataset_id"], unique=True, postgresql_where=sa.text("is_current")
    )
    op.create_table(
        "build_sample",
        sa.Column("build_id", sa.BigInteger(), nullable=False),
        sa.Column("sample_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.PrimaryKeyConstraint("build_id", "sample_id", name=op.f("pk_build_sample")),
        sa.ForeignKeyConstraint(
            ["build_id"], ["build.id"], name=op.f("fk_build_sample_build_id_build"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["sample_id"], ["sample.id"], name=op.f("fk_build_sample_sample_id_sample")),
    )
    op.create_index(op.f("ix_build_sample_sample_id"), "build_sample", ["sample_id"])


def downgrade() -> None:
    op.drop_table("build_sample")
    op.drop_table("build")
    op.drop_table("dataset_def")
