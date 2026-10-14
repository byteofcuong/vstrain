"""Index cho hash của chuỗi: lúc nộp, tìm mẫu có chuỗi giống hệt

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-15
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(op.f("ix_sample_sequence_sha256"), "sample_sequence", ["sha256"])


def downgrade() -> None:
    op.drop_index(op.f("ix_sample_sequence_sha256"), table_name="sample_sequence")
