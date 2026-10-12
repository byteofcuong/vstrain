"""Hàng đợi job nằm trong PostgreSQL.

Không cần Redis hay một broker riêng: `FOR UPDATE SKIP LOCKED` cho phép nhiều worker cùng lấy job mà không lấy
trùng và không chờ nhau, còn trạng thái của job nằm cùng chỗ với dữ liệu nên giao diện đọc trực tiếp được.
"""

import datetime as dt
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import Job, JobStatus

_ERROR_LIMIT = 4000


def enqueue(session: Session, kind: str, params: dict[str, Any] | None = None, *, priority: int = 0) -> Job:
    """Thêm job vào hàng đợi; job chỉ được worker thấy sau khi bên gọi commit."""
    job = Job(kind=kind, params=params or {}, priority=priority, status=JobStatus.QUEUED.value)
    session.add(job)
    session.flush()
    session.refresh(job)
    return job


def lock_next(session: Session) -> Job | None:
    """Khoá job đang chờ đứng đầu hàng; job mà worker khác đang khoá được bỏ qua chứ không chờ."""
    return session.scalars(
        select(Job)
        .where(Job.status == JobStatus.QUEUED.value)
        .order_by(Job.priority.desc(), Job.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).first()


def claim(session: Session, worker: str) -> Job | None:
    """Lấy một job về cho worker và đánh dấu đang chạy; trả `None` khi không còn job nào chờ."""
    job = lock_next(session)
    if job is None:
        session.rollback()
        return None
    job.status = JobStatus.RUNNING.value
    job.worker = worker
    job.started_at = job.heartbeat_at = func.now()
    session.commit()
    session.refresh(job)
    return job


def finish(session: Session, job: Job, result: dict[str, Any] | None = None) -> None:
    job.status = JobStatus.SUCCEEDED.value
    job.result = result
    job.finished_at = func.now()
    session.commit()


def fail(session: Session, job: Job, error: str) -> None:
    job.status = JobStatus.FAILED.value
    job.error = error[-_ERROR_LIMIT:]  # giữ phần cuối: nguyên nhân thường nằm ở cuối thông báo lỗi
    job.finished_at = func.now()
    session.commit()


def heartbeat(session: Session, job_id: int) -> None:
    """Worker báo job còn đang được xử lý."""
    session.execute(
        update(Job).where(Job.id == job_id, Job.status == JobStatus.RUNNING.value).values(heartbeat_at=func.now())
    )
    session.commit()


def fail_stale(session: Session, silent_for: dt.timedelta) -> int:
    """Đánh dấu thất bại các job đang chạy mà worker đã ngừng báo nhịp; trả về số job bị đánh dấu.

    Không tự chạy lại: job bị bỏ dở có thể đã ghi một phần kết quả, người vận hành quyết định xếp hàng lại.
    """
    result = session.execute(
        update(Job)
        .where(Job.status == JobStatus.RUNNING.value, Job.heartbeat_at < func.now() - silent_for)
        .values(
            status=JobStatus.FAILED.value,
            error="Worker stopped reporting while the job was running",
            finished_at=func.now(),
        )
    )
    session.commit()
    return result.rowcount
