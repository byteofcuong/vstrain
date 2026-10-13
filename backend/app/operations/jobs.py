"""Chạy lại một job đã hỏng.

Job hỏng không tự chạy lại (nó có thể đã ghi dở kết quả, và lỗi có thể lặp lại mãi). Người vận hành xem lỗi rồi
quyết định. Lần chạy lại là một job mới; job cũ được giữ nguyên để tra cứu.
"""

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.accounts.service import record
from app.jobs import queue
from app.jobs.schedule import BUILD_JOB, request_build
from app.models import AppUser, Job, JobStatus, Submission

INGEST_JOB = "ingest_sample"


class JobNotFound(LookupError):
    """Không có job mang mã này."""


class NotFailed(RuntimeError):
    """Chỉ job đã hỏng mới chạy lại được."""


class AlreadyRetried(RuntimeError):
    """Job này đã được chạy lại; muốn chạy lại nữa thì chạy lại job mới."""


def retry(session: Session, actor: AppUser, job_id: int) -> Job:
    """Xếp một job mới cùng loại, cùng tham số, cùng độ ưu tiên với job hỏng `job_id`. Chỉ flush.

    Ném `JobNotFound`, `NotFailed`, `AlreadyRetried`; với job dựng cây còn có `BuildAlreadyWaiting`, và `LookupError`
    khi dataset của nó không còn.
    """
    # Khoá dòng của job: hai lần bấm cùng lúc lần lượt xét, lần sau thấy job đã được chạy lại.
    failed = session.scalars(select(Job).where(Job.id == job_id).with_for_update()).one_or_none()
    if failed is None:
        raise JobNotFound(f"No job with id {job_id}")
    if failed.status != JobStatus.FAILED.value:
        raise NotFailed(f"Job {job_id} is {failed.status}")
    if session.scalar(select(Job.id).where(Job.retry_of == failed.id)) is not None:
        raise AlreadyRetried(f"Job {job_id} has already been retried")

    if failed.kind == BUILD_JOB:
        # Cùng một quy tắc với nút "Dựng ngay": mỗi dataset chỉ có một job dựng cây chưa xong.
        new = request_build(session, str(failed.params.get("dataset")))
        new.priority = failed.priority
    else:
        new = queue.enqueue(session, failed.kind, failed.params, priority=failed.priority)
    new.retry_of = failed.id
    if failed.kind == INGEST_JOB:
        # Tình trạng mẫu hiện cho người nộp được suy ra từ job của lần nộp.
        session.execute(update(Submission).where(Submission.job_id == failed.id).values(job_id=new.id))
    record(session, actor.id, "job_retried", f"job:{failed.id}", new_job=new.id)
    session.flush()
    return new
