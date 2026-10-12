"""Ngày lấy mẫu không đầy đủ.

GenBank ghi ngày theo mức biết được: "2019-03-15", "2019-03-XX", "2019-XX-XX" hoặc "XXXX-XX-XX". Mỗi giá trị
được lưu thành một khoảng [ngày sớm nhất, ngày muộn nhất] để lọc theo thời gian vẫn đúng khi ngày không trọn vẹn.
"""

import calendar
import datetime as dt
import re
from typing import NamedTuple

_PATTERN = re.compile(r"(\d{4}|XXXX)(?:-(\d{2}|XX)(?:-(\d{2}|XX))?)?")
_UNKNOWN = (None, "XX")


class DateRange(NamedTuple):
    start: dt.date
    end: dt.date


def parse_collection_date(raw: str | None) -> DateRange | None:
    """Khoảng ngày mà giá trị có thể chỉ; `None` nếu không biết năm.

    Giá trị sai định dạng gây `ValueError`, để phân biệt "không có ngày" với "ngày viết sai".
    """
    text = (raw or "").strip().upper()
    if not text:
        return None
    match = _PATTERN.fullmatch(text)
    if match is None:
        raise ValueError(f"Ngày lấy mẫu không đúng định dạng YYYY-MM-DD: {raw!r}")

    year, month, day = match.groups()
    if month in _UNKNOWN and day not in _UNKNOWN:
        raise ValueError(f"Ngày lấy mẫu có ngày mà không có tháng: {raw!r}")
    if year == "XXXX":
        if month not in _UNKNOWN:
            raise ValueError(f"Ngày lấy mẫu có tháng mà không có năm: {raw!r}")
        return None

    if month in _UNKNOWN:
        return DateRange(dt.date(int(year), 1, 1), dt.date(int(year), 12, 31))
    if day in _UNKNOWN:
        first = dt.date(int(year), int(month), 1)
        return DateRange(first, first.replace(day=calendar.monthrange(first.year, first.month)[1]))
    exact = dt.date(int(year), int(month), int(day))
    return DateRange(exact, exact)
