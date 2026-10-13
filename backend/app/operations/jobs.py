"""Chạy lại một job đã hỏng, và huỷ một job chưa xong.

Job hỏng không tự chạy lại (nó có thể đã ghi dở kết quả, và lỗi có thể lặp lại mãi). Người vận hành xem lỗi rồi
quyết định. Lần chạy lại là một job mới; job cũ được giữ nguyên để tra cứu.
"""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.accounts.service import record
from app.jobs import queue
from app.jobs.schedule import BUILD_JOB, request_build
from app.models import AppUser, Job, JobStatus, Submission

INGEST_JOB = "ingest_sample"


class JobNotFound(LookupError):
    """Không có job mang mã này."""


class NotFailed(RuntimeError):
    """Chỉ job đã hỏng hoặc đã bị huỷ mới chạy lại được."""


class AlreadyFinished(RuntimeError):
    """Job đã có kết cục (xong, hỏng, hoặc đã huỷ): không còn gì để huỷ."""


_STOPPED_SHORT = (JobStatus.FAILED.value, JobStatus.CANCELLED.value)
_UNFINISHED = (JobStatus.QUEUED.value, JobStatus.RUNNING.value)


class AlreadyRetried(RuntimeError):
    """Job này đã được chạy lại; muốn chạy lại nữa thì chạy lại job mới."""


def retry(session: Session, actor: AppUser, job_id: int) -> Job:
    """Xếp một job mới cùng loại, cùng tham số, cùng độ ưu tiên với job hỏng (hoặc đã huỷ) `job_id`. Chỉ flush.

    Ném `JobNotFound`, `NotFailed`, `AlreadyRetried`; với job dựng cây còn có `BuildAlreadyWaiting`, và `LookupError`
    khi dataset của nó không còn.
    """
    # Khoá dòng của job: hai lần bấm cùng lúc lần lượt xét, lần sau thấy job đã được chạy lại.
    failed = session.scalars(select(Job).where(Job.id == job_id).with_for_update()).one_or_none()
    if failed is None:
        raise JobNotFound(f"No job with id {job_id}")
    if failed.status not in _STOPPED_SHORT:
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


def cancel(session: Session, actor: AppUser, job_id: int) -> Job:
    """Huỷ một job đang chờ hoặc đang chạy: ghi kết cục `cancelled` ngay. Chỉ flush.

    Job đang chờ thì không worker nào nhận nó nữa. Job đang chạy thì worker của nó thấy kết cục này ở lần báo nhịp
    kế tiếp (hoặc trước bước kế tiếp) và tự dừng; việc nó đã ghi xong thì không được hoàn lại.
    Ném `JobNotFound`, `AlreadyFinished`.
    """
    # Khoá dòng của job: worker đang ghi kết cục của chính job này phải ghi xong trước, hoặc chờ tới sau.
    job = session.scalars(select(Job).where(Job.id == job_id).with_for_update()).one_or_none()
    if job is None:
        raise JobNotFound(f"No job with id {job_id}")
    if job.status not in _UNFINISHED:
        raise AlreadyFinished(f"Job {job_id} is {job.status}")
    was = job.status
    job.status = JobStatus.CANCELLED.value
    job.finished_at = func.now()
    record(session, actor.id, "job_cancelled", f"job:{job.id}", was=was)
    session.flush()
    return job
