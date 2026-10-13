"""Lịch build: xếp việc dựng lại cây của một dataset khi tới hạn và khi cây sẽ khác đi.

Với Nextstrain, lịch nằm ngoài ứng dụng (GitHub Actions chạy lại cả workflow theo giờ). Ở đây worker tự xét, và
chỉ dựng lại khi tập mẫu sẽ được chọn khác với tập mẫu của cây đang được phát: việc chọn mẫu là tất định, nên
cùng đầu vào thì dựng lại chỉ tốn máy mà ra đúng cây cũ.
"""

import datetime as dt
import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.build.selection import inputs_hash, select_samples
from app.jobs import queue
from app.models import Build, DatasetDef, Job, JobStatus

log = logging.getLogger(__name__)

BUILD_JOB = "build_dataset"
_WAITING = (JobStatus.QUEUED.value, JobStatus.RUNNING.value)


class BuildAlreadyWaiting(RuntimeError):
    """Dataset đã có một job dựng cây đang chờ hoặc đang chạy."""


def _of_dataset(slug: str):
    return (Job.kind == BUILD_JOB, Job.params["dataset"].astext == slug)


def _locked(session: Session, *conditions) -> list[DatasetDef]:
    """Các dataset thoả điều kiện, khoá dòng tới khi bên gọi commit: hai bên cùng xét một dataset thì lần lượt."""
    return list(session.scalars(select(DatasetDef).where(*conditions).order_by(DatasetDef.slug).with_for_update()))


def _has_waiting_build(session: Session, slug: str) -> bool:
    waiting = select(Job.id).where(*_of_dataset(slug), Job.status.in_(_WAITING)).limit(1)
    return session.scalar(waiting) is not None


def _is_due(session: Session, dataset: DatasetDef, now: dt.datetime) -> bool:
    if _has_waiting_build(session, dataset.slug):
        return False
    # Lần thử gần nhất tính theo cả job lẫn build: job hỏng trước khi chọn mẫu không để lại dòng build nào.
    last_job = session.scalar(select(func.max(Job.created_at)).where(*_of_dataset(dataset.slug)))
    last_build = session.scalar(select(func.max(Build.created_at)).where(Build.dataset_id == dataset.id))
    attempts = [moment for moment in (last_job, last_build) if moment is not None]
    if attempts and max(attempts) > now - dt.timedelta(hours=dataset.build_interval_hours):
        return False

    choices = select_samples(session, dataset)
    if not choices:
        return False
    # So với cây đang được phát, không phải với lần thử gần nhất: một lần build hỏng được thử lại ở chu kỳ sau.
    current = session.scalar(select(Build.inputs_hash).where(Build.dataset_id == dataset.id, Build.is_current))
    return current != inputs_hash(session, choices)


def enqueue_due_builds(session: Session, now: dt.datetime) -> list[int]:
    """Xếp một job dựng cây cho mỗi dataset có lịch đã tới hạn; trả về mã các job vừa xếp. Chỉ flush."""
    queued = []
    for dataset in _locked(session, DatasetDef.build_interval_hours.is_not(None)):
        if _is_due(session, dataset, now):
            job = queue.enqueue(session, BUILD_JOB, {"dataset": dataset.slug})
            log.info("Scheduled build of %s as job %s", dataset.slug, job.id)
            queued.append(job.id)
    return queued


def request_build(session: Session, slug: str) -> Job:
    """Xếp một job dựng cây theo yêu cầu của người vận hành, không xét hạn và không xét đầu vào. Chỉ flush.

    `LookupError` nếu không có dataset; `BuildAlreadyWaiting` nếu nó đã có job dựng cây chưa xong.
    """
    found = _locked(session, DatasetDef.slug == slug)
    if not found:
        raise LookupError(f"No dataset with slug {slug!r}")
    if _has_waiting_build(session, slug):
        raise BuildAlreadyWaiting(f"A build of {slug} is already waiting or running")
    return queue.enqueue(session, BUILD_JOB, {"dataset": slug})
