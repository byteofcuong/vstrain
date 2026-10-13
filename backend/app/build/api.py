import datetime as dt
import re
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.apimodel import ApiModel
from app.build.publish import builds_root
from app.db import SessionDep
from app.errors import ApiError
from app.models import Build, DatasetDef, Job, JobStatus

router = APIRouter(prefix="/api/datasets", tags=["datasets"])
files_router = APIRouter(tags=["builds"])

# Thư mục publish đặt tên theo hash nội dung và không bao giờ đổi, nên trình duyệt được giữ file vĩnh viễn.
_IMMUTABLE = "public, max-age=31536000, immutable"
# Đúng một dạng đường dẫn được phát: <slug>/b<mã build>/p-<12 chữ số hex>/<tên file>.
_PUBLISHED_FILE = re.compile(r"[a-z0-9][a-z0-9-]*/b[0-9]+/p-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]*")


class CurrentBuild(ApiModel):
    id: int
    sample_count: int | None
    published_at: dt.datetime | None
    content_hash: str | None
    manifest_url: str


class DatasetInfo(ApiModel):
    slug: str
    title: str
    pathogen: str
    lineage: str
    max_samples: int
    build_interval_hours: int | None  # số giờ giữa hai lần build tự động; `null` là không có lịch
    current_build: CurrentBuild | None


class DatasetPage(ApiModel):
    items: list[DatasetInfo]
    total: int
    limit: int
    offset: int


class BuildSummary(ApiModel):
    id: int
    status: str  # 'running' | 'succeeded' | 'failed'
    is_current: bool
    sample_count: int | None
    created_at: dt.datetime
    finished_at: dt.datetime | None
    published_at: dt.datetime | None


class DatasetDetail(DatasetInfo):
    builds: list[BuildSummary]


def _current_build(build: Build | None) -> CurrentBuild | None:
    if build is None:
        return None
    return CurrentBuild(
        id=build.id,
        sample_count=build.sample_count,
        published_at=build.published_at,
        content_hash=build.content_hash,
        manifest_url=f"/builds/{build.path}/manifest.json",
    )


def _dataset_info(dataset: DatasetDef, current: Build | None) -> dict:
    return {
        "slug": dataset.slug,
        "title": dataset.title,
        "pathogen": dataset.pathogen,
        "lineage": dataset.lineage,
        "max_samples": dataset.max_samples,
        "build_interval_hours": dataset.build_interval_hours,
        "current_build": _current_build(current),
    }


def _build_status(build: Build, job_status: str | None) -> str:
    """Trạng thái suy ra: đã publish là xong; chưa thì theo job; job không còn hoặc đã dừng là thất bại."""
    if build.path is not None:
        return "succeeded"
    if job_status in (JobStatus.QUEUED.value, JobStatus.RUNNING.value):
        return "running"
    return "failed"


def _current_builds(session: Session, dataset_ids: list[int]) -> dict[int, Build]:
    builds = session.scalars(select(Build).where(Build.dataset_id.in_(dataset_ids), Build.is_current))
    return {build.dataset_id: build for build in builds}


@router.get("")
def list_datasets(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> DatasetPage:
    """Các dataset, mỗi dataset kèm build hiện hành và địa chỉ manifest của nó."""
    total = session.scalar(select(func.count()).select_from(DatasetDef)) or 0
    datasets = session.scalars(select(DatasetDef).order_by(DatasetDef.slug).limit(limit).offset(offset)).all()
    current = _current_builds(session, [dataset.id for dataset in datasets])
    items = [DatasetInfo(**_dataset_info(dataset, current.get(dataset.id))) for dataset in datasets]
    return DatasetPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/{slug}")
def get_dataset(slug: str, session: SessionDep) -> DatasetDetail:
    """Một dataset cùng 20 build gần nhất của nó."""
    dataset = session.scalars(select(DatasetDef).filter_by(slug=slug)).one_or_none()
    if dataset is None:
        raise ApiError(404, "DATASET_NOT_FOUND", f"No dataset with slug {slug}")
    rows = session.execute(
        select(Build, Job.status)
        .outerjoin(Job, Job.id == Build.job_id)
        .where(Build.dataset_id == dataset.id)
        .order_by(Build.id.desc())
        .limit(20)
    ).all()
    builds = [
        BuildSummary(
            id=build.id,
            status=_build_status(build, job_status),
            is_current=build.is_current,
            sample_count=build.sample_count,
            created_at=build.created_at,
            finished_at=build.finished_at,
            published_at=build.published_at,
        )
        for build, job_status in rows
    ]
    current = _current_builds(session, [dataset.id]).get(dataset.id)
    return DatasetDetail(**_dataset_info(dataset, current), builds=builds)


@files_router.get("/builds/{path:path}", include_in_schema=False)
def build_file(path: str) -> FileResponse:
    """Phát một file của một bản publish. Khi triển khai thật, nginx phát thẳng thư mục này."""
    missing = ApiError(404, "FILE_NOT_FOUND", "No such published file")
    # Kiểm tra dạng đường dẫn trước khi chạm vào hệ thống file, rồi kiểm tra lại sau khi phân giải liên kết.
    if _PUBLISHED_FILE.fullmatch(path) is None:
        raise missing
    root = builds_root().resolve()
    target = (root / path).resolve()
    if not (target.is_relative_to(root) and target.is_file()):
        raise missing
    return FileResponse(target, headers={"Cache-Control": _IMMUTABLE})
