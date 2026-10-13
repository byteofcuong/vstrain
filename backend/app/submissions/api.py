"""API nộp mẫu: nộp, xem mẫu của mình, tip tạm của một dataset, và việc admin ẩn một mẫu."""

import datetime as dt
import functools
import json
import re
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts.api import AdminUser, CurrentUser
from app.accounts.service import record
from app.apimodel import ApiModel
from app.build.publish import builds_root
from app.db import SessionDep
from app.errors import INVALID_PARAMETERS, ApiError
from app.models import AppUser, Build, BuildSample, DatasetDef, Sample, SamplePlacement, SampleStatus, UserRole
from app.submissions import service
from app.submissions.validate import MAX_FASTA_CHARS, InvalidSubmission

router = APIRouter(prefix="/api/submissions", tags=["submissions"])
placements_router = APIRouter(prefix="/api/datasets", tags=["submissions"])
admin_router = APIRouter(prefix="/api/admin/samples", tags=["admin"])

MAX_PAGE_SIZE = 200
# Mã nội bộ do database sinh ra: chữ S và ít nhất bảy chữ số. Thứ gì khác không được đi tới câu truy vấn.
_INTERNAL_ID = re.compile(r"S[0-9]{7,18}")


class SubmissionIn(ApiModel):
    """Một lần nộp. Giới hạn ở đây chỉ chặn thứ quá cỡ; quy tắc thật nằm ở `validate`, nơi mỗi lỗi có một mã."""

    display_name: str = Field(max_length=4000)
    collection_date: str = Field(max_length=100)
    unit_code: str = Field(max_length=100)
    host: str | None = Field(default=None, max_length=4000)
    # Nội dung file FASTA dưới dạng văn bản. Trần ở đây rộng hơn giới hạn thật một chút, để file hơi quá cỡ
    # nhận lỗi `FASTA_TOO_LARGE` có mã thay vì một lỗi chung.
    fasta: str = Field(max_length=MAX_FASTA_CHARS + 1024 * 1024)


class DatasetRef(ApiModel):
    dataset: str
    title: str


class PlacedOn(DatasetRef):
    clade: str | None
    private_mutations: int


class SubmissionOut(ApiModel):
    internal_id: str
    display_name: str
    collection_date: str | None
    unit_code: str | None
    host: str | None
    status: str  # 'received' | 'accepted' | 'rejected' | 'hidden'
    # 'processing' | 'failed' | 'rejected' | 'hidden' | 'accepted' (đạt, chưa có cây để đặt) | 'placed' (đang là
    # tip tạm) | 'in_tree' (đã vào cây chính thức)
    stage: str
    reject_code: str | None
    reject_message: str | None
    lineage: str | None
    coverage: float | None
    valid_nt: int | None
    sequence_length: int | None
    submitted_at: dt.datetime
    submitter_name: str
    in_datasets: list[DatasetRef]
    placements: list[PlacedOn]


class SubmissionPage(ApiModel):
    items: list[SubmissionOut]
    total: int
    limit: int
    offset: int


class ProvisionalTip(ApiModel):
    """Một mẫu đã nộp, được gắn tạm vào cây của build hiện hành."""

    internal_id: str
    display_name: str
    collection_date: str | None
    date_min: dt.date | None
    date_max: dt.date | None
    unit_code: str | None
    host: str | None
    parent_node: str
    branch_node: str | None
    # Chỉ số của hai node đó trong `tree.json` của bản publish hiện hành: viewer giữ cây bằng mảng số.
    parent_index: int
    branch_index: int | None
    attach_div: float
    div: float
    private_mutations: int
    clade: str | None
    placed_at: dt.datetime


class PlacementList(ApiModel):
    build_id: int | None  # build mà các tên node thuộc về; `None` khi dataset chưa có build nào
    items: list[ProvisionalTip]


@functools.lru_cache(maxsize=8)
def _node_indices(tree_file: Path) -> dict[str, int]:
    """Chỉ số của từng node trong `tree.json` của một bản publish.

    Bản publish không bao giờ bị sửa, nên kết quả được giữ lại giữa các request.
    """
    names = json.loads(tree_file.read_text(encoding="utf-8"))["name"]
    return {name: index for index, name in enumerate(names)}


def _not_found(internal_id: str) -> ApiError:
    return ApiError(404, "SUBMISSION_NOT_FOUND", f"No submission with id {internal_id[:40]}")


@router.post("", status_code=201)
def submit(body: SubmissionIn, user: CurrentUser, session: SessionDep) -> SubmissionOut:
    """Nộp một genome. Mẫu được lưu ngay ở trạng thái `received`; việc kiểm tra và đặt lên cây chạy nền."""
    try:
        sample = service.submit(
            session,
            user,
            display_name=body.display_name,
            collection_date=body.collection_date,
            unit_code=body.unit_code,
            host=body.host,
            fasta=body.fasta,
            today=service.today_in_vietnam(),
        )
    except InvalidSubmission as error:
        details = [
            {"field": problem.field, "code": problem.code, "message": problem.message} for problem in error.problems
        ]
        raise ApiError(422, "VALIDATION_ERROR", INVALID_PARAMETERS, details) from None
    except service.TooManyPending:
        raise ApiError(
            429, "TOO_MANY_PENDING", "Too many of your submissions are still being checked; try again shortly"
        ) from None
    except service.TooManyToday:
        raise ApiError(
            429, "TOO_MANY_TODAY", f"No more than {service.MAX_PER_DAY} submissions are taken from one account in a day"
        ) from None
    session.commit()
    return SubmissionOut.model_validate(service.describe(session, [sample.id])[0])


@router.get("")
def list_submissions(
    user: CurrentUser,
    session: SessionDep,
    scope: Annotated[Literal["mine", "all"], Query(description="'all' chỉ dành cho admin")] = "mine",
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SubmissionPage:
    """Các mẫu người đang đăng nhập đã nộp, mới nhất trước. Admin xem được của mọi người với `scope=all`."""
    if scope == "all" and user.role != UserRole.ADMIN.value:
        raise ApiError(403, "FORBIDDEN", "Only an administrator can list everyone's submissions")
    items, total = service.list_submissions(
        session, submitter_id=None if scope == "all" else user.id, limit=limit, offset=offset
    )
    return SubmissionPage(
        items=[SubmissionOut.model_validate(item) for item in items], total=total, limit=limit, offset=offset
    )


@router.get("/{internal_id}")
def get_submission(internal_id: str, user: CurrentUser, session: SessionDep) -> SubmissionOut:
    """Một mẫu đã nộp. Mẫu của người khác trả 404 như mẫu không tồn tại; admin xem được mọi mẫu."""
    owner = None if user.role == UserRole.ADMIN.value else user.id
    found = (
        service.find_submission(session, internal_id, submitter_id=owner)
        if _INTERNAL_ID.fullmatch(internal_id)
        else None
    )
    if found is None:
        raise _not_found(internal_id)
    return SubmissionOut.model_validate(found)


@placements_router.get("/{slug}/placements")
def list_placements(slug: str, session: SessionDep) -> PlacementList:
    """Các tip tạm của một dataset: mẫu đã qua kiểm tra, chưa nằm trong build hiện hành, đã được gắn vào cây của nó.

    Công khai như chính dataset. Tên node chỉ có nghĩa với build có mã `buildId`.
    """
    dataset = session.scalars(select(DatasetDef).filter_by(slug=slug)).one_or_none()
    if dataset is None:
        raise ApiError(404, "DATASET_NOT_FOUND", f"No dataset with slug {slug[:60]}")
    build = session.scalars(select(Build).where(Build.dataset_id == dataset.id, Build.is_current)).one_or_none()
    if build is None or build.path is None:
        return PlacementList(build_id=None, items=[])
    build_id = build.id
    index_of = _node_indices(builds_root() / build.path / "tree.json")
    in_build = select(BuildSample.sample_id).where(BuildSample.build_id == build_id)
    rows = session.execute(
        select(Sample, SamplePlacement)
        .join(SamplePlacement, SamplePlacement.sample_id == Sample.id)
        .where(
            SamplePlacement.build_id == build_id,
            Sample.status == SampleStatus.ACCEPTED.value,
            Sample.id.not_in(in_build),
        )
        .order_by(Sample.id)
    ).all()
    items = [
        ProvisionalTip(
            internal_id=sample.internal_id,
            display_name=sample.display_name,
            collection_date=sample.collection_date_raw,
            date_min=sample.date_min,
            date_max=sample.date_max,
            unit_code=sample.admin_unit_code,
            host=sample.host,
            parent_node=placement.parent_node,
            branch_node=placement.branch_node,
            parent_index=index_of[placement.parent_node],
            branch_index=index_of[placement.branch_node] if placement.branch_node else None,
            attach_div=placement.attach_div,
            div=placement.div,
            private_mutations=placement.private_mutations,
            clade=placement.clade,
            placed_at=placement.placed_at,
        )
        for sample, placement in rows
        # Chỗ đặt trỏ tới node mà bản publish này không có (không nên xảy ra) thì viewer không vẽ được: bỏ qua.
        if placement.parent_node in index_of and (placement.branch_node is None or placement.branch_node in index_of)
    ]
    return PlacementList(build_id=build_id, items=items)


def _set_visibility(session: Session, admin: AppUser, internal_id: str, *, hide: bool) -> None:
    current, wanted = (
        (SampleStatus.ACCEPTED, SampleStatus.HIDDEN) if hide else (SampleStatus.HIDDEN, SampleStatus.ACCEPTED)
    )
    sample = (
        session.scalars(select(Sample).where(Sample.internal_id == internal_id).with_for_update()).one_or_none()
        if _INTERNAL_ID.fullmatch(internal_id)
        else None
    )
    if sample is None:
        raise ApiError(404, "SAMPLE_NOT_FOUND", f"No sample with id {internal_id[:40]}")
    if sample.status != current.value:
        raise ApiError(409, "INVALID_STATE", f"Only a sample that is {current.value} can become {wanted.value}")
    sample.status = wanted.value
    record(session, admin.id, "sample_hidden" if hide else "sample_unhidden", f"sample:{sample.internal_id}")
    session.commit()


@admin_router.post("/{internal_id}/hide", status_code=204)
def hide_sample(internal_id: str, admin: AdminUser, session: SessionDep) -> None:
    """Ẩn một mẫu: nó rời dữ liệu công khai và các tip tạm ngay, và không vào build kế tiếp."""
    _set_visibility(session, admin, internal_id, hide=True)


@admin_router.post("/{internal_id}/unhide", status_code=204)
def unhide_sample(internal_id: str, admin: AdminUser, session: SessionDep) -> None:
    _set_visibility(session, admin, internal_id, hide=False)
