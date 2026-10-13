"""Nộp mẫu: trạng thái của mẫu, lần nộp, và chỗ đặt tạm trên cây

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-13
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Giá trị mặc định là hằng số nên PostgreSQL không phải viết lại bảng: mọi mẫu đã có thành 'accepted'.
    op.add_column("sample", sa.Column("status", sa.String(20), server_default="accepted", nullable=False))
    op.create_check_constraint(
        op.f("ck_sample_status_known"), "sample", "status IN ('received', 'accepted', 'rejected', 'hidden')"
    )
    op.create_table(
        "submission",
        sa.Column("sample_id", sa.BigInteger(), nullable=False),
        sa.Column("submitter_id", sa.BigInteger(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=True),
        sa.Column("reject_code", sa.String(40), nullable=True),
        sa.Column("reject_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("sample_id", name=op.f("pk_submission")),
        sa.ForeignKeyConstraint(
            ["sample_id"], ["sample.id"], name=op.f("fk_submission_sample_id_sample"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["submitter_id"], ["app_user.id"], name=op.f("fk_submission_submitter_id_app_user")),
        sa.ForeignKeyConstraint(["job_id"], ["job.id"], name=op.f("fk_submission_job_id_job"), ondelete="SET NULL"),
    )
    op.create_index(op.f("ix_submission_submitter_id"), "submission", ["submitter_id"])
    op.create_table(
        "sample_placement",
        sa.Column("sample_id", sa.BigInteger(), nullable=False),
        sa.Column("build_id", sa.BigInteger(), nullable=False),
        sa.Column("parent_node", sa.String(100), nullable=False),
        sa.Column("branch_node", sa.String(100), nullable=True),
        sa.Column("attach_div", sa.Float(), nullable=False),
        sa.Column("div", sa.Float(), nullable=False),
        sa.Column("private_mutations", sa.Integer(), nullable=False),
        sa.Column("clade", sa.String(60), nullable=True),
        sa.Column("placed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("sample_id", "build_id", name=op.f("pk_sample_placement")),
        sa.ForeignKeyConstraint(
            ["sample_id"], ["sample.id"], name=op.f("fk_sample_placement_sample_id_sample"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["build_id"], ["build.id"], name=op.f("fk_sample_placement_build_id_build"), ondelete="CASCADE"
        ),
    )
    op.create_index(op.f("ix_sample_placement_build_id"), "sample_placement", ["build_id"])


def downgrade() -> None:
    op.drop_table("sample_placement")
    op.drop_table("submission")
    op.drop_constraint(op.f("ck_sample_status_known"), "sample", type_="check")
    op.drop_column("sample", "status")
