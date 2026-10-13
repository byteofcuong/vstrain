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
# Độ ưu tiên của việc có người đang chờ kết quả (kiểm tra một mẫu vừa nộp, gắn mẫu vào cây mới): đứng trước
# việc chạy theo lịch như dựng cây, vốn có độ ưu tiên 0.
INTERACTIVE = 10


def enqueue(session: Session, kind: str, params: dict[str, Any] | None = None, *, priority: int = 0) -> Job:
    """Thêm job vào hàng đợi; job chỉ được worker thấy sau khi bên gọi commit."""
    job = Job(kind=kind, params=params or {}, priority=priority, status=JobStatus.QUEUED.value)
    session.add(job)
    session.flush()
    session.refresh(job)
    return job


def lock_next(session: Session, kinds: frozenset[str] | None = None) -> Job | None:
    """Khoá job đang chờ đứng đầu hàng; job mà worker khác đang khoá được bỏ qua chứ không chờ.

    `kinds` giới hạn ở một số loại job; `None` là mọi loại.
    """
    waiting = select(Job).where(Job.status == JobStatus.QUEUED.value)
    if kinds is not None:
        waiting = waiting.where(Job.kind.in_(kinds))
    return session.scalars(
        waiting.order_by(Job.priority.desc(), Job.id).limit(1).with_for_update(skip_locked=True)
    ).first()


def claim(session: Session, worker: str, kinds: frozenset[str] | None = None) -> Job | None:
    """Lấy một job về cho worker và đánh dấu đang chạy; trả `None` khi không còn job nào (thuộc `kinds`) chờ."""
    job = lock_next(session, kinds)
    if job is None:
        session.rollback()
        return None
    job.status = JobStatus.RUNNING.value
    job.worker = worker
    job.started_at = job.heartbeat_at = func.now()
    session.commit()
    session.refresh(job)
    return job


def _close(session: Session, job: Job, status: JobStatus, **values: Any) -> bool:
    """Ghi kết cục của job, chỉ khi nó còn đang chạy; trả về có ghi được hay không.

    Job có thể đã bị đánh dấu thất bại vì worker im lặng quá lâu. Khi worker đó chạy xong, nó không được ghi
    đè lên kết cục đã có.
    """
    result = session.execute(
        update(Job)
        .where(Job.id == job.id, Job.status == JobStatus.RUNNING.value)
        .values(status=status.value, finished_at=func.now(), **values)
    )
    session.commit()
    return result.rowcount == 1


def finish(session: Session, job: Job, result: dict[str, Any] | None = None) -> bool:
    return _close(session, job, JobStatus.SUCCEEDED, result=result)


def fail(session: Session, job: Job, error: str) -> bool:
    # PostgreSQL không nhận ký tự NUL trong văn bản; giữ phần cuối vì nguyên nhân thường nằm ở cuối thông báo.
    return _close(session, job, JobStatus.FAILED, error=error.replace("\x00", "")[-_ERROR_LIMIT:])


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
