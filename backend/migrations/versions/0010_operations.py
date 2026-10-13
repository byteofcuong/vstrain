"""Vận hành: lịch build của dataset, hash đầu vào của build, job chạy lại

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-13
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dataset_def", sa.Column("build_interval_hours", sa.Integer(), nullable=True))
    op.create_check_constraint(
        op.f("ck_dataset_def_build_interval_in_range"),
        "dataset_def",
        "build_interval_hours IS NULL OR build_interval_hours BETWEEN 1 AND 8760",
    )
    # Build cũ không có hash: lần xét lịch đầu tiên coi đầu vào của chúng là đã đổi.
    op.add_column("build", sa.Column("inputs_hash", sa.String(64), nullable=True))
    op.add_column("job", sa.Column("retry_of", sa.BigInteger(), nullable=True))
    op.create_foreign_key(op.f("fk_job_retry_of_job"), "job", "job", ["retry_of"], ["id"], ondelete="SET NULL")
    # Mỗi job hỏng chỉ được chạy lại một lần; chạy lại nữa là chạy lại job mới.
    op.create_unique_constraint(op.f("uq_job_retry_of"), "job", ["retry_of"])


def downgrade() -> None:
    op.drop_constraint(op.f("uq_job_retry_of"), "job", type_="unique")
    op.drop_constraint(op.f("fk_job_retry_of_job"), "job", type_="foreignkey")
    op.drop_column("job", "retry_of")
    op.drop_column("build", "inputs_hash")
    op.drop_constraint(op.f("ck_dataset_def_build_interval_in_range"), "dataset_def", type_="check")
    op.drop_column("dataset_def", "build_interval_hours")
