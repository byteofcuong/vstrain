"""Bảng hàng đợi: job và job_step

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-12
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

EMPTY_OBJECT = sa.text("'{}'::jsonb")


def upgrade() -> None:
    op.create_table(
        "job",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("params", postgresql.JSONB(), server_default=EMPTY_OBJECT, nullable=False),
        sa.Column("status", sa.String(20), server_default="queued", nullable=False),
        sa.Column("priority", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("worker", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job")),
        sa.CheckConstraint("status IN ('queued', 'running', 'succeeded', 'failed')", name=op.f("ck_job_status_known")),
    )
    op.create_index(op.f("ix_job_status"), "job", ["status"])
    op.create_table(
        "job_step",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metrics", postgresql.JSONB(), server_default=EMPTY_OBJECT, nullable=False),
        sa.Column("log_tail", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job_step")),
        sa.ForeignKeyConstraint(["job_id"], ["job.id"], name=op.f("fk_job_step_job_id_job"), ondelete="CASCADE"),
        sa.UniqueConstraint("job_id", "position", name=op.f("uq_job_step_job_id")),
    )
    op.create_index(op.f("ix_job_step_job_id"), "job_step", ["job_id"])


def downgrade() -> None:
    op.drop_table("job_step")
    op.drop_table("job")
