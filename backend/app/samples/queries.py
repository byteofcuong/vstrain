"""Truy vấn mẫu theo địa danh và thời gian: việc Nextstrain không làm được ở phía server."""

import datetime as dt
from collections import defaultdict
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Row, func, or_, select
from sqlalchemy.orm import Session

from app.models import AdminUnit, Sample, SampleSequence

_SUMMARY = (
    Sample.internal_id,
    Sample.display_name,
    Sample.accession,
    Sample.pathogen,
    Sample.source,
    Sample.collection_date_raw.label("collection_date"),
    Sample.date_min,
    Sample.date_max,
    Sample.country,
    Sample.division_raw.label("division"),
    Sample.location_raw.label("location"),
    Sample.admin_unit_code.label("unit_code"),
    Sample.region_code,
    Sample.geo_status,
    Sample.host,
    SampleSequence.length.label("sequence_length"),
)


class UnknownUnit(LookupError):
    pass


def unit_scope(session: Session, code: str) -> set[str]:
    """Đơn vị cùng mọi đơn vị nằm trong nó: tỉnh cũ đã gộp vào (qua đơn vị kế thừa) và đơn vị con (qua đơn vị cha).

    Bảng đơn vị chỉ có khoảng một trăm dòng nên được duyệt trong bộ nhớ, dễ đọc hơn một truy vấn đệ quy.
    """
    links = session.execute(select(AdminUnit.code, AdminUnit.parent_code, AdminUnit.successor_code)).all()
    members: dict[str, set[str]] = defaultdict(set)
    for unit, parent, successor in links:
        for container in (parent, successor):
            if container is not None:
                members[container].add(unit)
    if code not in {unit for unit, _, _ in links}:
        raise UnknownUnit(code)

    scope, pending = {code}, [code]
    while pending:
        for member in members[pending.pop()] - scope:
            scope.add(member)
            pending.append(member)
    return scope


def list_samples(
    session: Session,
    *,
    unit: str | None = None,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    limit: int,
    offset: int,
) -> tuple[Sequence[Row[Any]], int]:
    """Một trang mẫu, mới nhất trước, và tổng số mẫu khớp điều kiện."""
    conditions = []
    if unit is not None:
        scope = unit_scope(session, unit)
        conditions.append(or_(Sample.admin_unit_code.in_(scope), Sample.region_code.in_(scope)))
    # Chỉ giữ mẫu chắc chắn được lấy trong khoảng hỏi: "2019-XX-XX" thuộc năm 2019 nhưng không thuộc tháng 3/2019.
    if date_from is not None:
        conditions.append(Sample.date_min >= date_from)
    if date_to is not None:
        conditions.append(Sample.date_max <= date_to)

    total = session.scalar(select(func.count()).select_from(Sample).where(*conditions)) or 0
    rows = session.execute(
        select(*_SUMMARY)
        .outerjoin(SampleSequence, SampleSequence.sample_id == Sample.id)
        .where(*conditions)
        .order_by(Sample.date_max.desc().nulls_last(), Sample.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return rows, total


def get_sample(session: Session, internal_id: str) -> Row[Any] | None:
    return session.execute(
        select(*_SUMMARY, Sample.meta)
        .outerjoin(SampleSequence, SampleSequence.sample_id == Sample.id)
        .where(Sample.internal_id == internal_id)
    ).one_or_none()
