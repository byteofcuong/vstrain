"""Nạp đơn vị hành chính và tên thay thế từ các file TSV trong `app/geo/data`.

Nguồn và mức độ đã đối chiếu của từng file ghi ở `app/geo/data/NGUON.md`.
"""

import csv
import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.geo.normalize import place_key, strip_diacritics
from app.models import AdminUnit, PlaceAlias, UnitLevel

DATA_DIR = Path(__file__).parent / "data"

# Nghị quyết 202/2025/QH15: chính quyền của 34 đơn vị mới hoạt động từ ngày này.
MERGER_DATE = dt.date(2025, 7, 1)

OLD_SET = "vn63"
NEW_SET = "vn34"


class AliasConflict(ValueError):
    """Hai cách viết cho cùng một khoá nhưng trỏ tới hai đơn vị khác nhau."""


@dataclass(frozen=True)
class AliasCandidate:
    text: str
    unit_code: str
    kind: str


def unit_code(unit_set: str, name: str) -> str:
    slug = "-".join("".join(c if c.isalnum() else " " for c in strip_diacritics(name).lower()).split())
    return f"{unit_set}:{slug}"


def alias_rows(candidates: Iterable[AliasCandidate]) -> list[dict[str, str]]:
    """Đổi các cách viết thành dòng `place_alias`; cách viết đứng trước quyết định loại và ví dụ của khoá."""
    rows: dict[str, dict[str, str]] = {}
    for candidate in candidates:
        key = place_key(candidate.text)
        if not key:
            raise ValueError(f"Cách viết {candidate.text!r} của {candidate.unit_code} không có chữ hay số nào")
        known = rows.get(key)
        if known is None:
            rows[key] = {
                "key": key,
                "unit_code": candidate.unit_code,
                "kind": candidate.kind,
                "source": "seed",
                "example": candidate.text,
            }
        elif known["unit_code"] != candidate.unit_code:
            raise AliasConflict(
                f"{known['example']!r} ({known['unit_code']}) và {candidate.text!r} ({candidate.unit_code}) "
                f"cùng cho khoá {key!r}"
            )
    return list(rows.values())


def _read_tsv(name: str) -> list[dict[str, str]]:
    with (DATA_DIR / name).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def _split(value: str | None) -> list[str]:
    return [item.strip() for item in (value or "").split("|") if item.strip()]


def _unit(code: str, level: UnitLevel, name_vi: str, name_en: str, **fields: Any) -> dict[str, Any]:
    # Mọi dòng phải có cùng bộ cột để chèn chung trong một câu lệnh.
    blank = {"unit_set": None, "parent_code": None, "successor_code": None, "valid_from": None, "valid_to": None}
    return {"code": code, "level": level.value, "name_vi": name_vi, "name_en": name_en, **blank, **fields}


def load_seed_data() -> tuple[list[dict[str, Any]], list[AliasCandidate]]:
    units: list[dict[str, Any]] = []
    candidates: list[AliasCandidate] = []

    for row in _read_tsv("regions.tsv"):
        units.append(
            _unit(
                row["code"], UnitLevel(row["level"]), row["name_vi"], row["name_en"], parent_code=row["parent"] or None
            )
        )
        candidates += [AliasCandidate(name, row["code"], "name") for name in (row["name_vi"], row["name_en"])]
        candidates += [AliasCandidate(text, row["code"], "variant") for text in _split(row["aliases"])]

    new_units: dict[str, str] = {}
    for row in _read_tsv("provinces_vn63.tsv"):
        code = unit_code(OLD_SET, row["name_vi"])
        successor = unit_code(NEW_SET, row["successor"])
        new_units[successor] = row["successor"]
        units.append(
            _unit(
                code,
                UnitLevel.PROVINCE,
                row["name_vi"],
                strip_diacritics(row["name_vi"]),
                unit_set=OLD_SET,
                parent_code=row["region"],
                successor_code=successor,
                valid_to=MERGER_DATE - dt.timedelta(days=1),
            )
        )
        candidates.append(AliasCandidate(row["name_vi"], code, "name"))
        candidates += [AliasCandidate(text, code, "variant") for text in _split(row["variants"])]

    # Đơn vị bộ 34 không có tên thay thế riêng: tên của chúng đều là tên một tỉnh bộ 63, và bộ phân giải
    # đi từ tỉnh bộ 63 sang đơn vị kế thừa theo ngày lấy mẫu.
    for code, name in new_units.items():
        units.append(
            _unit(code, UnitLevel.PROVINCE, name, strip_diacritics(name), unit_set=NEW_SET, valid_from=MERGER_DATE)
        )

    for row in _read_tsv("city_aliases.tsv"):
        candidates.append(AliasCandidate(row["alias"], unit_code(OLD_SET, row["province"]), "city"))

    return units, candidates


def seed_geo(session: Session) -> dict[str, int]:
    """Nạp hoặc cập nhật dữ liệu địa danh; chạy lại bao nhiêu lần cũng cho cùng kết quả."""
    units, candidates = load_seed_data()
    aliases = alias_rows(candidates)

    upsert = insert(AdminUnit).values(units)
    updated = {name: upsert.excluded[name] for name in units[0] if name != "code"}
    session.execute(upsert.on_conflict_do_update(index_elements=[AdminUnit.code], set_=updated))

    # Tên thay thế do admin thêm được giữ nguyên, kể cả khi trùng khoá với dữ liệu khởi tạo.
    session.execute(delete(PlaceAlias).where(PlaceAlias.source == "seed"))
    session.execute(insert(PlaceAlias).values(aliases).on_conflict_do_nothing(index_elements=[PlaceAlias.key]))
    session.flush()
    return {"units": len(units), "aliases": len(aliases)}
