"""Gán đơn vị hành chính cho một mẫu từ địa danh gốc và ngày lấy mẫu."""

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.geo.normalize import place_key
from app.models import AdminUnit, PlaceAlias, UnitLevel


class GeoStatus(StrEnum):
    PROVINCE = "province"  # ra được đơn vị cấp tỉnh
    REGION = "region"  # chỉ ra được vùng hoặc miền
    MISSING = "missing"  # địa danh gốc để trống
    UNRESOLVED = "unresolved"  # có chữ nhưng không khớp tên nào
    FOREIGN = "foreign"  # mẫu ngoài Việt Nam, không gán đơn vị; bộ phân giải không trả về giá trị này


@dataclass(frozen=True)
class ResolvedPlace:
    status: GeoStatus
    unit_code: str | None = None  # đơn vị cấp tỉnh có hiệu lực vào ngày lấy mẫu
    region_code: str | None = None  # vùng hoặc miền
    matched: str | None = None  # giá trị gốc đã khớp


@dataclass(frozen=True)
class _Unit:
    # Bản sao gọn của AdminUnit, để bộ phân giải không phụ thuộc vòng đời của session.
    code: str
    level: str
    parent_code: str | None
    successor_code: str | None
    valid_to: dt.date | None


_SPECIFICITY = {UnitLevel.MACRO_REGION: 1, UnitLevel.REGION: 2, UnitLevel.PROVINCE: 3}


class PlaceResolver:
    """Tra địa danh trong bộ nhớ: nạp bảng một lần rồi dùng cho cả lô mẫu."""

    def __init__(self, units: Iterable[AdminUnit], aliases: Iterable[PlaceAlias]) -> None:
        self._units = {
            unit.code: _Unit(unit.code, unit.level, unit.parent_code, unit.successor_code, unit.valid_to)
            for unit in units
        }
        self._unit_of_key = {alias.key: alias.unit_code for alias in aliases}

    @classmethod
    def load(cls, session: Session) -> "PlaceResolver":
        return cls(session.scalars(select(AdminUnit)), session.scalars(select(PlaceAlias)))

    def resolve(
        self,
        division: str | None = None,
        location: str | None = None,
        date_min: dt.date | None = None,
        date_max: dt.date | None = None,
    ) -> ResolvedPlace:
        """`location` chi tiết hơn `division` nên được xét trước; tên cấp tỉnh thắng tên vùng, vùng thắng miền."""
        texts = [text for text in (location, division) if place_key(text)]
        if not texts:
            return ResolvedPlace(GeoStatus.MISSING)

        matches = [
            (text, self._units[code]) for text in texts if (code := self._unit_of_key.get(place_key(text))) is not None
        ]
        if not matches:
            return ResolvedPlace(GeoStatus.UNRESOLVED)

        # max() giữ phần tử đầu khi bằng nhau, nên `location` thắng khi hai trường cùng cấp.
        text, unit = max(matches, key=lambda match: _SPECIFICITY[UnitLevel(match[1].level)])
        if unit.level != UnitLevel.PROVINCE:
            return ResolvedPlace(GeoStatus.REGION, region_code=unit.code, matched=text)

        unit = self._unit_valid_until(unit, date_max)
        return ResolvedPlace(GeoStatus.PROVINCE, unit_code=unit.code, region_code=unit.parent_code, matched=text)

    def _unit_valid_until(self, unit: _Unit, date_max: dt.date | None) -> _Unit:
        """Đi theo đơn vị kế thừa cho tới khi đơn vị còn hiệu lực vào ngày muộn nhất mẫu có thể được lấy.

        Không biết ngày thì coi như có thể sau mọi mốc: đơn vị kế thừa rộng hơn nên chắc chắn chứa nơi lấy mẫu,
        còn đơn vị cũ thì chỉ đúng nếu mẫu được lấy trước ngày nó hết hiệu lực.
        """
        while (
            unit.valid_to is not None
            and unit.successor_code is not None
            and (date_max is None or date_max > unit.valid_to)
        ):
            unit = self._units[unit.successor_code]
        return unit
