"""Worker: lấy job từ hàng đợi và chạy handler tương ứng. Chạy bằng `python -m app.jobs.worker`.

Thêm `--only <loại job>...` để worker chỉ nhận vài loại job. Bản triển khai chạy hai worker: một cái nhận mọi
loại, một cái chỉ nhận việc kiểm tra mẫu vừa nộp, để người nộp không phải chờ một lần dựng cây đang chạy.
"""

import argparse
import datetime as dt
import logging
import os
import signal
import socket
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path

from sqlalchemy.orm import Session

from app.accounts import service as accounts
from app.jobs import queue
from app.jobs.cleanup import purge_work_dirs
from app.jobs.schedule import BUILD_JOB, enqueue_due_builds
from app.jobs.steps import Handler, JobContext, JobStopped

log = logging.getLogger(__name__)

SessionFactory = Callable[[], AbstractContextManager[Session]]
# Việc định kỳ nhận một session; worker commit sau khi nó chạy xong.
Chore = Callable[[Session], object]


class Worker:
    def __init__(
        self,
        session_factory: SessionFactory,
        handlers: Mapping[str, Handler],
        *,
        name: str,
        work_root: Path,
        heartbeat_seconds: float | None = 15,
        stale_after: dt.timedelta = dt.timedelta(seconds=90),
        work_retention: dt.timedelta | None = None,
        cleanup_seconds: float = 3600,
        kinds: frozenset[str] | None = None,
        schedule: Chore | None = None,
        schedule_seconds: float = 60,
        housekeeping: Chore | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.handlers = handlers
        self.name = name
        self.work_root = work_root
        self.heartbeat_seconds = heartbeat_seconds
        self.stale_after = stale_after
        self.work_retention = work_retention  # `None`: không bao giờ xoá thư mục làm việc
        self.cleanup_seconds = cleanup_seconds
        self.kinds = kinds  # `None`: nhận mọi loại job
        self.schedule = schedule  # xét lịch build; chạy giữa các job, kể cả khi hàng đợi không lúc nào trống
        self.schedule_seconds = schedule_seconds
        self.housekeeping = housekeeping  # dọn dữ liệu quá hạn; chạy lúc rảnh, cùng nhịp với dọn thư mục làm việc
        self._next_cleanup = 0.0
        self._next_schedule = 0.0

    def run_one(self) -> bool:
        """Lấy và chạy một job; trả `False` khi hàng đợi trống."""
        with self.session_factory() as session:
            # Job mà worker trước bỏ dở (container bị dừng giữa chừng) không bao giờ tự kết thúc.
            queue.fail_stale(session, self.stale_after)
            job = queue.claim(session, self.name, self.kinds)
            if job is None:
                return False

            log.info("Job %s (%s) started", job.id, job.kind)
            work_dir = self.work_root / f"job-{job.id}"
            work_dir.mkdir(parents=True, exist_ok=True)
            context = JobContext(session=session, job=job, work_dir=work_dir)
            with self._heartbeat(job.id, context.stop):
                try:
                    handler = self.handlers.get(job.kind)
                    if handler is None:
                        raise LookupError(f"No handler for job kind {job.kind!r}")
                    result = handler(context)
                    # Ghi kết quả nằm trong `try`: kết quả không lưu được (không phải JSON) cũng là job thất bại.
                    if queue.finish(session, job, result):
                        log.info("Job %s succeeded", job.id)
                    else:
                        log.warning("Job %s finished after it had been closed; result discarded", job.id)
                except JobStopped:
                    # Kết cục của job đã được ghi bởi người huỷ nó; ở đây chỉ còn việc bỏ phần đang làm dở.
                    log.warning("Job %s stopped: it was cancelled or given up on while it ran", job.id)
                    session.rollback()
                except Exception as error:
                    # Lỗi của một job không được làm worker dừng: ghi lại rồi lấy job kế tiếp.
                    log.exception("Job %s failed", job.id)
                    session.rollback()
                    queue.fail(session, job, f"{type(error).__name__}: {error}")
            return True

    def run_forever(self, *, poll_seconds: float = 1.0, stop: threading.Event | None = None) -> None:
        stop = stop or threading.Event()
        while not stop.is_set():
            self._schedule_when_due()
            try:
                worked = self.run_one()
            except Exception:
                # Lỗi ngoài handler (mất kết nối database chẳng hạn) không được làm worker thoát.
                log.exception("Worker loop error; trying again")
                worked = False
            if not worked:
                self._cleanup_when_due()
                stop.wait(poll_seconds)

    def _schedule_when_due(self) -> None:
        """Mỗi `schedule_seconds` một lần, xét lịch build. Lỗi ở đây không được làm worker ngừng nhận job."""
        if self.schedule is None or time.monotonic() < self._next_schedule:
            return
        self._next_schedule = time.monotonic() + self.schedule_seconds
        try:
            with self.session_factory() as session:
                self.schedule(session)
                session.commit()
        except Exception:
            log.exception("Checking the build schedule failed")

    def _cleanup_when_due(self) -> None:
        """Lúc rảnh, mỗi `cleanup_seconds` một lần: xoá thư mục làm việc của job đã kết thúc quá lâu, rồi dọn dẹp."""
        if time.monotonic() < self._next_cleanup:
            return
        self._next_cleanup = time.monotonic() + self.cleanup_seconds
        if self.work_retention is not None:
            try:
                with self.session_factory() as session:
                    removed = purge_work_dirs(session, self.work_root, self.work_retention)
                if removed:
                    log.info("Removed %s old work directories", removed)
            except Exception:
                log.exception("Cleaning up work directories failed")
        if self.housekeeping is not None:
            try:
                with self.session_factory() as session:
                    self.housekeeping(session)
                    session.commit()
            except Exception:
                log.exception("Housekeeping failed")

    @contextmanager
    def _heartbeat(self, job_id: int, stop: threading.Event) -> Iterator[None]:
        """Luồng phụ báo nhịp bằng kết nối riêng, vì luồng chính đang bận chạy công cụ.

        Lần báo nhịp thấy job không còn đang chạy thì bật `stop`: công cụ đang chạy bị dừng, không bước nào bắt đầu.
        """
        if self.heartbeat_seconds is None:
            yield
            return

        done = threading.Event()

        def beat() -> None:
            while not done.wait(self.heartbeat_seconds):
                try:
                    with self.session_factory() as session:
                        still_running = queue.heartbeat(session, job_id)
                    if not still_running:
                        stop.set()
                        return
                except Exception:
                    log.exception("Heartbeat for job %s failed", job_id)

        thread = threading.Thread(target=beat, name=f"heartbeat-{job_id}", daemon=True)
        thread.start()
        try:
            yield
        finally:
            done.set()
            thread.join()


def selected_kinds(only: list[str] | None, handlers: Mapping[str, object]) -> frozenset[str] | None:
    """Các loại job mà `--only` chọn; `None` khi không giới hạn. Loại không có handler là lỗi gõ nhầm."""
    if only is None:
        return None
    unknown = sorted(set(only) - set(handlers))
    if unknown:
        raise ValueError(f"No handler for job kind: {', '.join(unknown)}")
    return frozenset(only)


def builds_trees(kinds: frozenset[str] | None) -> bool:
    """Worker có nhận job dựng cây không. Chỉ worker như vậy mới xét lịch build và làm việc dọn dẹp chung."""
    return kinds is None or BUILD_JOB in kinds


def _housekeeping(audit_retention: dt.timedelta) -> Chore:
    def purge(session: Session) -> None:
        removed = accounts.purge_stale(session, now=dt.datetime.now(dt.UTC), audit_retention=audit_retention)
        if any(removed.values()):
            log.info("Removed %(sessions)s expired sessions and %(audit_rows)s old audit rows", removed)

    return purge


def main(argv: list[str] | None = None) -> None:
    # Import ở đây để module này dùng được trong test mà không cần kết nối database chính.
    from app.config import settings
    from app.db import SessionLocal
    from app.jobs.handlers import HANDLERS

    parser = argparse.ArgumentParser(prog="python -m app.jobs.worker", description="Worker chạy job nền")
    parser.add_argument("--only", nargs="+", metavar="KIND", help="chỉ nhận các loại job này")
    arguments = parser.parse_args(argv)
    try:
        kinds = selected_kinds(arguments.only, HANDLERS)
    except ValueError as error:
        parser.error(str(error))

    general = builds_trees(kinds)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    stop = threading.Event()
    for signal_number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signal_number, lambda *_: stop.set())

    worker = Worker(
        SessionLocal,
        HANDLERS,
        name=f"{socket.gethostname()}:{os.getpid()}",
        work_root=Path(settings.work_dir),
        work_retention=dt.timedelta(days=settings.work_retention_days),
        kinds=kinds,
        schedule=(lambda session: enqueue_due_builds(session, dt.datetime.now(dt.UTC))) if general else None,
        housekeeping=_housekeeping(dt.timedelta(days=settings.audit_retention_days)) if general else None,
    )
    log.info("Worker %s waiting for jobs: %s", worker.name, ", ".join(sorted(kinds or HANDLERS)))
    worker.run_forever(stop=stop)
    log.info("Worker %s stopped", worker.name)


if __name__ == "__main__":
    main()
