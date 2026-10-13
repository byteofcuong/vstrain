"""Job có thêm trạng thái `cancelled`: admin huỷ được một job đang chờ hoặc đang chạy

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-14
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

_BEFORE = "status IN ('queued', 'running', 'succeeded', 'failed')"
_AFTER = "status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')"


def upgrade() -> None:
    op.drop_constraint(op.f("ck_job_status_known"), "job", type_="check")
    op.create_check_constraint(op.f("ck_job_status_known"), "job", _AFTER)


def downgrade() -> None:
    # Schema cũ không có chỗ ghi "đã huỷ". Job đã huỷ được giữ lại như một job hỏng, với lý do ghi rõ: cả hai đều
    # là job không chạy tới cùng, và cả hai đều chạy lại được.
    op.execute(
        "UPDATE job SET status = 'failed', error = coalesce(error, 'Cancelled by an administrator') "
        "WHERE status = 'cancelled'"
    )
    op.drop_constraint(op.f("ck_job_status_known"), "job", type_="check")
    op.create_check_constraint(op.f("ck_job_status_known"), "job", _BEFORE)
