"""build: bỏ cột status

Trạng thái của một build suy ra được từ job của nó và từ việc nó đã được publish hay chưa. Lưu thêm một cột
riêng thì khi worker chết giữa chừng, job được đánh dấu failed còn build vẫn ghi "running".

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-12
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_build_status_known"), "build", type_="check")
    op.drop_column("build", "status")


def downgrade() -> None:
    op.add_column("build", sa.Column("status", sa.String(20), server_default="failed", nullable=False))
    op.alter_column("build", "status", server_default=None)
    op.create_check_constraint(op.f("ck_build_status_known"), "build", "status IN ('running', 'succeeded', 'failed')")
