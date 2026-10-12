"""build.published_at; slug của dataset chỉ gồm chữ thường, số và gạch nối

Slug được dùng làm tên thư mục khi publish, nên định dạng của nó được chốt ở DB chứ không dựa vào mã ứng dụng.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-12
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("build", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(op.f("ck_dataset_def_slug_is_path_safe"), "dataset_def", "slug ~ '^[a-z0-9][a-z0-9-]*$'")


def downgrade() -> None:
    op.drop_constraint(op.f("ck_dataset_def_slug_is_path_safe"), "dataset_def", type_="check")
    op.drop_column("build", "published_at")
