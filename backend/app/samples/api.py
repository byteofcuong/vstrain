import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query

from app.db import SessionDep
from app.errors import ApiError, invalid_parameter
from app.samples import queries
from app.samples.schemas import SampleDetail, SamplePage, SampleSummary

router = APIRouter(prefix="/api/samples", tags=["samples"])

MAX_PAGE_SIZE = 500


@router.get("")
def list_samples(
    session: SessionDep,
    unit: Annotated[str | None, Query(description="Mã đơn vị: tỉnh (bộ 63 hoặc 34), vùng hoặc miền")] = None,
    date_from: Annotated[dt.date | None, Query(alias="dateFrom", description="Lấy mẫu từ ngày này")] = None,
    date_to: Annotated[dt.date | None, Query(alias="dateTo", description="Lấy mẫu đến hết ngày này")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SamplePage:
    """Danh sách mẫu theo đơn vị hành chính và khoảng ngày lấy mẫu.

    Sắp theo ngày muộn nhất mà mẫu có thể được lấy, giảm dần; mẫu không có ngày đứng cuối.
    Bộ lọc ngày chỉ giữ mẫu chắc chắn nằm trong khoảng: mẫu chỉ biết năm không khớp khi hỏi một tháng.
    """
    if date_from is not None and date_to is not None and date_to < date_from:
        raise invalid_parameter("dateTo", "dateTo must not be earlier than dateFrom")
    try:
        rows, total = queries.list_samples(
            session, unit=unit, date_from=date_from, date_to=date_to, limit=limit, offset=offset
        )
    except queries.UnknownUnit:
        raise invalid_parameter("unit", f"No administrative unit with code {unit}") from None
    return SamplePage(
        items=[SampleSummary.model_validate(row) for row in rows], total=total, limit=limit, offset=offset
    )


@router.get("/{internal_id}")
def get_sample(internal_id: str, session: SessionDep) -> SampleDetail:
    """Một mẫu theo mã nội bộ, kèm toàn bộ metadata gốc; không kèm chuỗi."""
    row = queries.get_sample(session, internal_id)
    if row is None:
        raise ApiError(404, "SAMPLE_NOT_FOUND", f"No sample with id {internal_id}")
    return SampleDetail.model_validate(row)
