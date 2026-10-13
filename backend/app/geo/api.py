"""Danh mục đơn vị hành chính cho giao diện: form nộp mẫu chọn tỉnh từ danh sách này, không gõ tên tự do."""

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.apimodel import ApiModel
from app.db import SessionDep
from app.models import AdminUnit

router = APIRouter(prefix="/api/units", tags=["geo"])


class UnitOut(ApiModel):
    code: str
    level: str
    unit_set: str | None  # 'vn63' | 'vn34' với tỉnh; vùng và miền không thuộc bộ nào
    name_vi: str
    name_en: str
    parent_code: str | None
    successor_code: str | None
    valid_from: dt.date | None
    valid_to: dt.date | None


class UnitList(ApiModel):
    items: list[UnitOut]


@router.get("")
def list_units(
    session: SessionDep,
    level: Annotated[Literal["macro_region", "region", "province"] | None, Query()] = None,
) -> UnitList:
    """Các đơn vị hành chính, kèm thời gian hiệu lực: bộ 63 tỉnh tới 2025-06-30, bộ 34 đơn vị từ 2025-07-01."""
    query = select(AdminUnit).order_by(AdminUnit.level, AdminUnit.unit_set, AdminUnit.code)
    if level is not None:
        query = query.where(AdminUnit.level == level)
    return UnitList(items=[UnitOut.model_validate(unit) for unit in session.scalars(query)])
