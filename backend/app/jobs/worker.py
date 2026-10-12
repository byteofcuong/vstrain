"""Worker: lấy job từ hàng đợi và chạy handler tương ứng. Chạy bằng `python -m app.jobs.worker`."""

import datetime as dt
import logging
import os
import signal
import socket
import threading
from collections.abc import Callable, Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path

from sqlalchemy.orm import Session

from app.jobs import queue
from app.jobs.steps import Handler, JobContext

log = logging.getLogger(__name__)

SessionFactory = Callable[[], AbstractContextManager[Session]]


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
    ) -> None:
        self.session_factory = session_factory
        self.handlers = handlers
        self.name = name
        self.work_root = work_root
        self.heartbeat_seconds = heartbeat_seconds
        self.stale_after = stale_after

    def run_one(self) -> bool:
        """Lấy và chạy một job; trả `False` khi hàng đợi trống."""
        with self.session_factory() as session:
            # Job mà worker trước bỏ dở (container bị dừng giữa chừng) không bao giờ tự kết thúc.
            queue.fail_stale(session, self.stale_after)
            job = queue.claim(session, self.name)
            if job is None:
                return False

            log.info("Job %s (%s) started", job.id, job.kind)
            work_dir = self.work_root / f"job-{job.id}"
            work_dir.mkdir(parents=True, exist_ok=True)
            context = JobContext(session=session, job=job, work_dir=work_dir)
            with self._heartbeat(job.id):
                try:
                    handler = self.handlers.get(job.kind)
                    if handler is None:
                        raise LookupError(f"No handler for job kind {job.kind!r}")
                    result = handler(context)
                except Exception as error:
                    # Lỗi của một job không được làm worker dừng: ghi lại rồi lấy job kế tiếp.
                    log.exception("Job %s failed", job.id)
                    session.rollback()
                    queue.fail(session, job, f"{type(error).__name__}: {error}")
                else:
                    queue.finish(session, job, result)
                    log.info("Job %s succeeded", job.id)
            return True

    def run_forever(self, *, poll_seconds: float = 1.0, stop: threading.Event | None = None) -> None:
        stop = stop or threading.Event()
        while not stop.is_set():
            if not self.run_one():
                stop.wait(poll_seconds)

    @contextmanager
    def _heartbeat(self, job_id: int) -> Iterator[None]:
        """Luồng phụ báo nhịp bằng kết nối riêng, vì luồng chính đang bận chạy công cụ."""
        if self.heartbeat_seconds is None:
            yield
            return

        done = threading.Event()

        def beat() -> None:
            while not done.wait(self.heartbeat_seconds):
                try:
                    with self.session_factory() as session:
                        queue.heartbeat(session, job_id)
                except Exception:
                    log.exception("Heartbeat for job %s failed", job_id)

        thread = threading.Thread(target=beat, name=f"heartbeat-{job_id}", daemon=True)
        thread.start()
        try:
            yield
        finally:
            done.set()
            thread.join()


def main() -> None:
    # Import ở đây để module này dùng được trong test mà không cần kết nối database chính.
    from app.config import settings
    from app.db import SessionLocal
    from app.jobs.handlers import HANDLERS

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    stop = threading.Event()
    for signal_number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signal_number, lambda *_: stop.set())

    worker = Worker(
        SessionLocal, HANDLERS, name=f"{socket.gethostname()}:{os.getpid()}", work_root=Path(settings.work_dir)
    )
    log.info("Worker %s waiting for jobs: %s", worker.name, ", ".join(sorted(HANDLERS)))
    worker.run_forever(stop=stop)
    log.info("Worker %s stopped", worker.name)


if __name__ == "__main__":
    main()
