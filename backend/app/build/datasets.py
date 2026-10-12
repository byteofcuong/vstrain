"""Các dataset mặc định, tạo cùng lúc khởi tạo database."""

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import DatasetDef
from app.pathogens import DENGUE

# 2.000 là cỡ đã đo ở baseline P1 (771 giây khi dựng lại toàn bộ bằng pipeline của Nextstrain).
DEFAULT_MAX_SAMPLES = 2000


def seed_datasets(session: Session) -> int:
    """Tạo dataset cho từng lineage nếu chưa có; dataset đã có được giữ nguyên, kể cả khi đã bị chỉnh."""
    rows = [
        {
            "slug": f"{lineage.pathogen}-{lineage.key}",
            "title": f"{lineage.title}: Việt Nam và bối cảnh thế giới",
            "pathogen": lineage.pathogen,
            "lineage": lineage.key,
            "max_samples": DEFAULT_MAX_SAMPLES,
        }
        for lineage in DENGUE.values()
    ]
    statement = insert(DatasetDef).values(rows).on_conflict_do_nothing(index_elements=[DatasetDef.slug])
    # Đếm bằng RETURNING: rowcount không đáng tin với lệnh chèn nhiều dòng.
    return len(session.execute(statement.returning(DatasetDef.id)).all())
