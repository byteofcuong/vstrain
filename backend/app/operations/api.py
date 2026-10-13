"""API vận hành, chỉ dành cho admin: theo dõi và chạy lại job, lịch build của dataset, sửa địa danh chưa khớp."""

import datetime as dt
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Path, Query
from pydantic import Field
from sqlalchemy import func, select

from app.accounts.api import AdminUser
from app.accounts.service import record
from app.apimodel import ApiModel
from app.db import SessionDep
from app.errors import INVALID_PARAMETERS, ApiError
from app.jobs.schedule import BuildAlreadyWaiting, request_build
from app.models import DatasetDef, Job, JobStatus, JobStep
from app.operations import jobs, places

router = APIRouter(prefix="/api/admin", tags=["operations"])

MAX_PAGE_SIZE = 500
_ERROR_LINE_CHARS = 300
_SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,59}")
_ALIAS_KEY = re.compile(r"[a-z0-9]{1,100}")

JobStatusName = Literal["queued", "running", "succeeded", "failed"]
# Mã job là BIGINT: số lớn hơn thế bị từ chối ở đây, không tới được database.
JobId = Annotated[int, Path(ge=1, le=2**63 - 1)]


class JobSummary(ApiModel):
    id: int
    kind: str
    status: str
    params: dict[str, Any]
    priority: int
    worker: str | None
    created_at: dt.datetime
    started_at: dt.datetime | None
    finished_at: dt.datetime | None
    seconds: float | None  # thời gian chạy của job đã kết thúc
    error: str | None  # trong danh sách: chỉ dòng đầu; ở trang chi tiết: đầy đủ
    retry_of: int | None


class JobCounts(ApiModel):
    queued: int
    running: int
    succeeded: int
    failed: int


class JobPage(ApiModel):
    items: list[JobSummary]
    total: int
    limit: int
    offset: int
    counts: JobCounts  # của cả hàng đợi, không theo bộ lọc
    oldest_queued_seconds: float | None  # job chờ lâu nhất đã chờ bao lâu: hàng đợi có bị nghẽn không


class StepOut(ApiModel):
    position: int
    name: str
    status: str
    started_at: dt.datetime
    finished_at: dt.datetime | None
    seconds: float | None
    log_tail: str | None


class JobDetail(JobSummary):
    result: dict[str, Any] | None
    retried_by: int | None  # job chạy lại job này, nếu có
    steps: list[StepOut]


class JobRef(ApiModel):
    id: int


class ScheduleIn(ApiModel):
    # Bắt buộc phải có trường này: `null` là tắt lịch, còn thiếu trường là request sai.
    build_interval_hours: Annotated[int | None, Field(ge=1, le=8760)]


class ScheduleOut(ApiModel):
    slug: str
    build_interval_hours: int | None


class UnresolvedPlace(ApiModel):
    key: str
    text: str  # cách viết gặp nhiều nhất của khoá này
    spellings: list[str]
    samples: int


class UnresolvedPlaces(ApiModel):
    items: list[UnresolvedPlace]
    samples: int  # số mẫu chưa khớp, mỗi mẫu tính một lần


class AliasOut(ApiModel):
    key: str
    text: str
    unit_code: str
    unit_name: str


class AliasList(ApiModel):
    items: list[AliasOut]


class AliasIn(ApiModel):
    text: str = Field(min_length=1, max_length=200)
    unit_code: str = Field(max_length=100)


class AliasAdded(ApiModel):
    key: str
    text: str
    unit_code: str
    changed_samples: int
    republished: list[str]  # slug các dataset có build hiện hành được publish lại


class AliasRemoved(ApiModel):
    key: str
    changed_samples: int
    republished: list[str]


def _seconds(job: Job) -> float | None:
    if job.started_at is None or job.finished_at is None:
        return None
    return round((job.finished_at - job.started_at).total_seconds(), 3)


def _summary(job: Job, *, whole_error: bool = False) -> dict[str, Any]:
    error = job.error
    if error and not whole_error:
        error = next(iter(error.splitlines()), "")[:_ERROR_LINE_CHARS]
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "params": job.params,
        "priority": job.priority,
        "worker": job.worker,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "seconds": _seconds(job),
        "error": error,
        "retry_of": job.retry_of,
    }


# --- Job ---


@router.get("/jobs")
def list_jobs(
    _admin: AdminUser,
    session: SessionDep,
    status: Annotated[JobStatusName | None, Query()] = None,
    kind: Annotated[str | None, Query(max_length=40)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> JobPage:
    """Các job, mới nhất trước, kèm tình hình của cả hàng đợi."""
    wanted = []
    if status is not None:
        wanted.append(Job.status == status)
    if kind is not None:
        wanted.append(Job.kind == kind)
    total = session.scalar(select(func.count()).select_from(Job).where(*wanted)) or 0
    found = session.scalars(select(Job).where(*wanted).order_by(Job.id.desc()).limit(limit).offset(offset)).all()
    by_status = dict(session.execute(select(Job.status, func.count()).group_by(Job.status)).all())
    oldest = session.scalar(
        select(func.extract("epoch", func.now() - func.min(Job.created_at))).where(Job.status == JobStatus.QUEUED.value)
    )
    return JobPage(
        items=[JobSummary(**_summary(job)) for job in found],
        total=total,
        limit=limit,
        offset=offset,
        counts=JobCounts(**{one.value: by_status.get(one.value, 0) for one in JobStatus}),
        oldest_queued_seconds=None if oldest is None else round(float(oldest), 1),
    )


def _job_not_found(job_id: int) -> ApiError:
    return ApiError(404, "JOB_NOT_FOUND", f"No job with id {job_id}")


@router.get("/jobs/{job_id}")
def get_job(job_id: JobId, _admin: AdminUser, session: SessionDep) -> JobDetail:
    """Một job cùng các bước của nó: thời gian và đuôi log của từng bước."""
    job = session.get(Job, job_id)
    if job is None:
        raise _job_not_found(job_id)
    steps = session.scalars(select(JobStep).filter_by(job_id=job.id).order_by(JobStep.position)).all()
    return JobDetail(
        **_summary(job, whole_error=True),
        result=job.result,
        retried_by=session.scalar(select(Job.id).where(Job.retry_of == job.id)),
        steps=[
            StepOut(
                position=step.position,
                name=step.name,
                status=step.status,
                started_at=step.started_at,
                finished_at=step.finished_at,
                seconds=step.metrics.get("wall_seconds"),
                log_tail=step.log_tail,
            )
            for step in steps
        ],
    )


@router.post("/jobs/{job_id}/retry", status_code=201)
def retry_job(job_id: JobId, admin: AdminUser, session: SessionDep) -> JobRef:
    """Chạy lại một job hỏng bằng một job mới cùng loại và cùng tham số."""
    try:
        new = jobs.retry(session, admin, job_id)
    except jobs.JobNotFound:
        raise _job_not_found(job_id) from None
    except jobs.NotFailed:
        raise ApiError(409, "JOB_NOT_FAILED", "Only a failed job can be retried") from None
    except jobs.AlreadyRetried:
        raise ApiError(409, "JOB_ALREADY_RETRIED", "This job has already been retried") from None
    except BuildAlreadyWaiting:
        raise _build_waiting() from None
    except LookupError:
        raise ApiError(409, "DATASET_GONE", "The dataset of this build no longer exists") from None
    session.commit()
    return JobRef(id=new.id)


# --- Lịch của dataset ---


def _build_waiting() -> ApiError:
    return ApiError(409, "BUILD_ALREADY_WAITING", "A build of this dataset is already waiting or running")


def _dataset_not_found(slug: str) -> ApiError:
    return ApiError(404, "DATASET_NOT_FOUND", f"No dataset with slug {slug[:60]}")


@router.patch("/datasets/{slug}")
def set_schedule(slug: str, body: ScheduleIn, admin: AdminUser, session: SessionDep) -> ScheduleOut:
    """Đặt số giờ giữa hai lần build tự động của một dataset; `null` là tắt lịch."""
    dataset = (
        session.scalars(select(DatasetDef).filter_by(slug=slug).with_for_update()).one_or_none()
        if _SLUG.fullmatch(slug)
        else None
    )
    if dataset is None:
        raise _dataset_not_found(slug)
    dataset.build_interval_hours = body.build_interval_hours
    record(session, admin.id, "dataset_schedule_changed", f"dataset:{slug}", hours=body.build_interval_hours)
    session.commit()
    return ScheduleOut(slug=dataset.slug, build_interval_hours=dataset.build_interval_hours)


@router.post("/datasets/{slug}/builds", status_code=202)
def build_now(slug: str, admin: AdminUser, session: SessionDep) -> JobRef:
    """Xếp một lần dựng cây ngay, không chờ lịch. Mỗi dataset chỉ có một job dựng cây chưa xong."""
    try:
        if not _SLUG.fullmatch(slug):
            raise LookupError(slug)
        job = request_build(session, slug)
    except LookupError:
        raise _dataset_not_found(slug) from None
    except BuildAlreadyWaiting:
        raise _build_waiting() from None
    record(session, admin.id, "build_requested", f"dataset:{slug}", job=job.id)
    session.commit()
    return JobRef(id=job.id)


# --- Địa danh ---


@router.get("/places/unresolved")
def unresolved_places(_admin: AdminUser, session: SessionDep) -> UnresolvedPlaces:
    """Các cách viết địa danh chưa khớp được với đơn vị nào, cách viết có nhiều mẫu nhất trước."""
    return UnresolvedPlaces.model_validate(places.unresolved_places(session))


@router.get("/places/aliases")
def list_aliases(_admin: AdminUser, session: SessionDep) -> AliasList:
    """Các tên thay thế do admin thêm (tên có sẵn từ dữ liệu khởi tạo không nằm ở đây)."""
    return AliasList(items=[AliasOut.model_validate(alias) for alias in places.admin_aliases(session)])


@router.post("/places/aliases", status_code=201)
def add_alias(body: AliasIn, admin: AdminUser, session: SessionDep) -> AliasAdded:
    """Gán một cách viết cho một đơn vị, phân giải lại mẫu, và publish lại các cây có mẫu vừa đổi."""
    try:
        added = places.add_alias(session, admin, text=body.text, unit_code=body.unit_code)
    except places.EmptyPlace:
        raise ApiError(
            422, "EMPTY_PLACE", INVALID_PARAMETERS, [{"field": "text", "message": "No letters or digits"}]
        ) from None
    except places.UnknownUnit:
        raise ApiError(
            422, "UNKNOWN_UNIT", INVALID_PARAMETERS, [{"field": "unitCode", "message": "No unit with this code"}]
        ) from None
    except places.AliasExists:
        raise ApiError(409, "ALIAS_EXISTS", "This spelling already points to a unit") from None
    session.commit()
    return AliasAdded.model_validate(added)


@router.delete("/places/aliases/{key}")
def remove_alias(key: str, admin: AdminUser, session: SessionDep) -> AliasRemoved:
    """Xoá một tên thay thế do admin thêm; mẫu được phân giải lại như lúc thêm."""
    try:
        if not _ALIAS_KEY.fullmatch(key):
            raise LookupError(key)
        removed = places.remove_alias(session, admin, key)
    except LookupError:
        raise ApiError(404, "ALIAS_NOT_FOUND", "No alias with this key") from None
    except places.SeedAlias:
        raise ApiError(409, "SEED_ALIAS", "This alias comes from the seed data and cannot be removed here") from None
    session.commit()
    return AliasRemoved.model_validate(removed)
