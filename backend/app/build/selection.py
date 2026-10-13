"""Chọn mẫu cho một lần build của dataset.

Quy tắc: lấy mẫu trong nước trước, rồi thêm mẫu bối cảnh thế giới chia đều theo (nước, năm) cho tới trần.
Thứ tự trong mỗi nhóm cố định theo một hàm băm, không ngẫu nhiên: cùng dữ liệu cho cùng tập mẫu, và một mẫu
mới chỉ làm đổi nhiều nhất một lựa chọn cũ. Nhờ vậy cây của hai lần build liên tiếp gần giống nhau.
"""

import hashlib
from collections import defaultdict
from collections.abc import Hashable, Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DatasetDef, Sample, SampleAlignment, SampleStatus
from app.pathogens import get_lineage


@dataclass(frozen=True)
class Choice:
    sample_id: int
    role: str  # 'home': mẫu trong nước; 'context': mẫu bối cảnh thế giới


def _rank(salt: str, value: object) -> str:
    return hashlib.sha1(f"{salt}:{value!r}".encode()).hexdigest()  # noqa: S324 - chỉ để xếp thứ tự, không bảo mật


def _round_robin(groups: dict[Hashable, list[int]], budget: int, salt: str) -> list[int]:
    """Lần lượt lấy một mẫu ở mỗi nhóm cho tới khi đủ `budget`."""
    queues = [
        sorted(members, key=lambda sample_id: _rank(salt, sample_id))
        for _, members in sorted(groups.items(), key=lambda item: _rank(salt, item[0]))
    ]
    taken: list[int] = []
    depth = 0
    while len(taken) < budget:
        layer = [queue[depth] for queue in queues if depth < len(queue)]
        if not layer:
            break
        taken.extend(layer[: budget - len(taken)])
        depth += 1
    return taken


def select_samples(session: Session, dataset: DatasetDef) -> list[Choice]:
    lineage = get_lineage(dataset.pathogen, dataset.lineage)
    candidates = session.execute(
        select(Sample.id, Sample.country, Sample.date_min, Sample.admin_unit_code, Sample.region_code)
        .join(SampleAlignment, SampleAlignment.sample_id == Sample.id)
        .where(
            Sample.pathogen == dataset.pathogen,
            Sample.status == SampleStatus.ACCEPTED.value,
            SampleAlignment.lineage == dataset.lineage,
            SampleAlignment.status == "aligned",
            SampleAlignment.valid_nt >= lineage.min_valid_nt,
            Sample.date_min.is_not(None),  # cây theo thời gian cần ít nhất năm lấy mẫu
        )
    ).all()

    home: dict[Hashable, list[int]] = defaultdict(list)
    context: dict[Hashable, list[int]] = defaultdict(list)
    for sample_id, country, date_min, unit_code, region_code in candidates:
        if country == dataset.home_country:
            home[(unit_code or region_code, date_min.year)].append(sample_id)
        else:
            context[(country, date_min.year)].append(sample_id)

    home_budget = int(dataset.max_samples * (1 - dataset.min_context_share))
    chosen_home = _round_robin(home, home_budget, dataset.slug)
    chosen_context = _round_robin(context, dataset.max_samples - len(chosen_home), dataset.slug)
    return [Choice(sample_id, "home") for sample_id in chosen_home] + [
        Choice(sample_id, "context") for sample_id in chosen_context
    ]


def inputs_hash(session: Session, choices: Sequence[Choice]) -> str:
    """Hash của những gì một cây được dựng từ: mẫu nào được chọn, ngày lấy mẫu và chuỗi của từng mẫu.

    Hai lần chọn cho cùng hash thì dựng lại cũng ra cùng cây, nên lịch build bỏ qua. Địa danh và tên hiển thị không
    nằm trong hash: chúng chỉ đổi các cột thuộc tính của bản publish, không đổi cây.
    """
    roles = {choice.sample_id: choice.role for choice in choices}
    rows = session.execute(
        select(Sample.id, Sample.date_min, Sample.date_max, SampleAlignment.sequence_sha256)
        .join(SampleAlignment, SampleAlignment.sample_id == Sample.id)
        .where(Sample.id.in_(roles))
        .order_by(Sample.id)
    )
    digest = hashlib.sha256()
    for sample_id, date_min, date_max, sequence in rows:
        digest.update(f"{sample_id}|{roles[sample_id]}|{date_min}|{date_max}|{sequence}\n".encode())
    return digest.hexdigest()
