"""Sửa địa danh chưa khớp: thêm một cách viết vào bảng tên thay thế, rồi phân giải lại các mẫu.

Với Nextstrain, một cách viết lạ phải được thêm vào file TSV trong repo rồi chạy lại cả pipeline. Ở đây địa danh
gốc của mẫu được giữ nguyên văn trong database, nên thêm một dòng `place_alias` là đủ để phân giải lại; cây không
bị dựng lại, chỉ các cột địa bàn của bản publish được viết lại.
"""

import re
from collections import Counter, defaultdict
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.accounts.service import record
from app.geo.normalize import place_key
from app.geo.resolve import GeoStatus, PlaceResolver
from app.jobs.schedule import queue_republish
from app.models import AdminUnit, AppUser, PlaceAlias, Sample

_UNIT_CODE = re.compile(r"[a-z0-9]+:[a-z0-9-]+")
_MAX_SPELLINGS = 5
# Khoá nằm trong `place_alias.key` và, sau tiền tố "place:", trong `audit_log.subject`; cả hai cột dài 100 ký tự.
MAX_KEY_CHARS = 80
# Mọi thay đổi bảng tên thay thế lần lượt từng cái một: mỗi thay đổi phân giải lại mẫu dựa trên cả bảng.
_ALIAS_LOCK = 0x76735F616C696173  # "vs_alias"


class EmptyPlace(ValueError):
    """Cách viết không có chữ hay số nào, nên không có khoá để so khớp."""


class PlaceTooLong(ValueError):
    """Khoá của cách viết dài hơn chỗ để lưu nó."""


class UnknownUnit(ValueError):
    """Không có đơn vị hành chính nào mang mã này."""


class AliasExists(RuntimeError):
    """Khoá của cách viết này đã trỏ tới một đơn vị."""


class SeedAlias(RuntimeError):
    """Tên thay thế có sẵn trong dữ liệu khởi tạo; nó được sửa ở file seed, không sửa trên giao diện."""


def unresolved_places(session: Session) -> dict[str, Any]:
    """Các cách viết địa danh mà bộ phân giải chưa khớp được, gộp theo khoá, kèm số mẫu dùng mỗi cách viết."""
    rows = session.execute(
        select(Sample.division_raw, Sample.location_raw, func.count())
        .where(Sample.geo_status == GeoStatus.UNRESOLVED.value)
        .group_by(Sample.division_raw, Sample.location_raw)
    ).all()
    samples: Counter[str] = Counter()
    spellings: dict[str, Counter[str]] = defaultdict(Counter)
    for division, location, count in rows:
        # Mẫu có cả hai trường được tính ở cả hai cách viết: gán được trường nào thì mẫu cũng được phân giải.
        for text in {division, location}:
            key = place_key(text)
            if key:
                samples[key] += count
                spellings[key][text.strip()] += count

    items = []
    for key, count in sorted(samples.items(), key=lambda item: (-item[1], item[0])):
        ranked = [text for text, _ in sorted(spellings[key].items(), key=lambda item: (-item[1], item[0]))]
        items.append({"key": key, "text": ranked[0], "spellings": ranked[:_MAX_SPELLINGS], "samples": count})
    return {"items": items, "samples": sum(count for _, _, count in rows)}


def admin_aliases(session: Session) -> list[dict[str, Any]]:
    rows = session.execute(
        select(PlaceAlias, AdminUnit.name_vi)
        .join(AdminUnit, AdminUnit.code == PlaceAlias.unit_code)
        .where(PlaceAlias.source == "admin")
        .order_by(PlaceAlias.key)
    ).all()
    return [
        {"key": alias.key, "text": alias.example, "unit_code": alias.unit_code, "unit_name": name}
        for alias, name in rows
    ]


def resolve_again(session: Session) -> list[int]:
    """Phân giải lại địa danh của mọi bản ghi GenBank trong nước; trả về mã các mẫu có kết quả đổi. Chỉ flush.

    Dùng đúng bộ phân giải của lúc nhập. Mẫu do phòng xét nghiệm nộp không được xét: tỉnh của nó do người nộp chọn.
    """
    resolver = PlaceResolver.load(session)
    rows = session.execute(
        select(
            Sample.id,
            Sample.division_raw,
            Sample.location_raw,
            Sample.date_min,
            Sample.date_max,
            Sample.geo_status,
            Sample.admin_unit_code,
            Sample.region_code,
        ).where(Sample.source == "genbank", Sample.geo_status != GeoStatus.FOREIGN.value)
    ).all()
    changes = []
    for row in rows:
        place = resolver.resolve(row.division_raw, row.location_raw, row.date_min, row.date_max)
        after = (place.status.value, place.unit_code, place.region_code)
        if after != (row.geo_status, row.admin_unit_code, row.region_code):
            changes.append({"id": row.id, "geo_status": after[0], "admin_unit_code": after[1], "region_code": after[2]})
    if changes:
        session.execute(update(Sample), changes)
        session.flush()
    return [change["id"] for change in changes]


def _serialise_alias_changes(session: Session) -> None:
    session.execute(select(func.pg_advisory_xact_lock(_ALIAS_LOCK)))


def add_alias(session: Session, actor: AppUser, *, text: str, unit_code: str) -> dict[str, Any]:
    """Gán cách viết `text` cho đơn vị `unit_code`, phân giải lại mẫu và xếp việc publish lại. Chỉ flush."""
    key = place_key(text)
    if not key:
        raise EmptyPlace("The spelling has no letters or digits")
    if len(key) > MAX_KEY_CHARS:
        raise PlaceTooLong(f"The key of this spelling is longer than {MAX_KEY_CHARS} characters")
    _serialise_alias_changes(session)
    if (session.get(AdminUnit, unit_code) if _UNIT_CODE.fullmatch(unit_code) else None) is None:
        raise UnknownUnit("No administrative unit with this code")
    if session.get(PlaceAlias, key) is not None:
        raise AliasExists(f"The key {key} already points to a unit")
    session.add(PlaceAlias(key=key, unit_code=unit_code, kind="variant", source="admin", example=text.strip()))
    session.flush()
    changed = resolve_again(session)
    republished = queue_republish(session, changed)
    record(session, actor.id, "place_alias_added", f"place:{key}", unit=unit_code, samples=len(changed))
    session.flush()
    return {
        "key": key,
        "text": text.strip(),
        "unit_code": unit_code,
        "changed_samples": len(changed),
        "republished": republished,
    }


def remove_alias(session: Session, actor: AppUser, key: str) -> dict[str, Any]:
    """Xoá một tên thay thế do admin thêm, rồi phân giải lại như lúc thêm. Chỉ flush."""
    _serialise_alias_changes(session)
    alias = session.get(PlaceAlias, key)
    if alias is None:
        raise LookupError(f"No alias with key {key}")
    if alias.source != "admin":
        raise SeedAlias(f"The alias {key} comes from the seed data")
    session.delete(alias)
    session.flush()
    changed = resolve_again(session)
    republished = queue_republish(session, changed)
    record(session, actor.id, "place_alias_removed", f"place:{key}", samples=len(changed))
    session.flush()
    return {"key": key, "changed_samples": len(changed), "republished": republished}
