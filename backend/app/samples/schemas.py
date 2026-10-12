"""Hợp đồng của API tra cứu mẫu."""

import datetime as dt
from typing import Any

from app.apimodel import ApiModel


class SampleSummary(ApiModel):
    internal_id: str
    display_name: str
    accession: str | None
    pathogen: str
    source: str
    collection_date: str | None  # nguyên văn, có thể không trọn vẹn: "2019-XX-XX"
    date_min: dt.date | None
    date_max: dt.date | None
    country: str | None
    division: str | None  # địa danh gốc, nguyên văn
    location: str | None
    unit_code: str | None
    region_code: str | None
    geo_status: str
    host: str | None
    sequence_length: int | None


class SampleDetail(SampleSummary):
    meta: dict[str, Any]


class SamplePage(ApiModel):
    items: list[SampleSummary]
    total: int
    limit: int
    offset: int
