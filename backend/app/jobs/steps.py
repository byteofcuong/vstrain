"""Ghi từng bước của job vào DB.

Snakemake chỉ cho biết tiến độ qua log trên terminal. Ở đây mỗi bước là một dòng `job_step` được commit ngay
khi bắt đầu và khi kết thúc, nên giao diện thấy job đang ở bước nào, mất bao lâu và lỗi ở đâu.
"""

import threading
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.jobs import tools
from app.models import Job, JobStatus, JobStep

_LOG_TAIL_CHARS = 4000


class JobStopped(BaseException):
    """Job không còn ở trạng thái đang chạy (admin đã huỷ, hoặc nó bị coi là bỏ dở): việc dừng ở đây.

    Không kế thừa `Exception`, như `asyncio.CancelledError`: handler có chỗ bắt `Exception` để ghi nhận một công cụ
    hỏng rồi đi tiếp, và lệnh dừng phải đi xuyên qua những chỗ đó.
    """


@dataclass
class StepHandle:
    """Thứ một bước đang chạy được ghi thêm: số đo riêng của nó và đuôi log."""

    metrics: dict[str, Any] = field(default_factory=dict)
    log_tail: str | None = None


@dataclass
class JobContext:
    """Thứ một handler nhận được: job, thư mục làm việc riêng, và cách ghi bước."""

    session: Session
    job: Job
    work_dir: Path
    allowed_tools: frozenset[str] = tools.ALLOWED_TOOLS
    # Lệnh dừng: worker bật nó khi lần báo nhịp thấy job không còn đang chạy; công cụ đang chạy bị dừng theo.
    stop: threading.Event = field(default_factory=threading.Event)
    _steps: int = 0

    @property
    def params(self) -> dict[str, Any]:
        return self.job.params

    def check_params(self, *allowed: str) -> None:
        """Từ chối job có tham số lạ, thay vì lặng lẽ bỏ qua: tham số chỉ được là những gì handler khai báo."""
        unknown = sorted(set(self.params) - set(allowed))
        if unknown:
            raise ValueError(f"Unknown job parameters: {', '.join(unknown)[:200]}")

    def _stop_unless_running(self) -> None:
        """Hỏi lại database trước mỗi bước: lần báo nhịp có thể chưa tới, mà bước kế tiếp có thể là publish."""
        if not self.stop.is_set():
            status = self.session.scalar(select(Job.status).where(Job.id == self.job.id))
            if status == JobStatus.RUNNING.value:
                return
            self.stop.set()
        raise JobStopped(f"Job {self.job.id} is no longer running")

    @contextmanager
    def step(self, name: str) -> Iterator[StepHandle]:
        self._stop_unless_running()
        self._steps += 1
        row = JobStep(job_id=self.job.id, position=self._steps, name=name, status="running")
        self.session.add(row)
        self.session.commit()

        handle = StepHandle()
        started = time.monotonic()
        try:
            yield handle
        except BaseException as error:
            # Bỏ mọi thay đổi dở dang của bước rồi mới ghi trạng thái, để dòng job_step luôn ghi được.
            self.session.rollback()
            status = "cancelled" if isinstance(error, JobStopped) else "failed"
            self._close(row, status, handle, started, handle.log_tail or f"{type(error).__name__}: {error}")
            raise
        self._close(row, "succeeded", handle, started, handle.log_tail)

    def _close(self, row: JobStep, status: str, handle: StepHandle, started: float, log_tail: str | None) -> None:
        row.status = status
        row.finished_at = func.now()
        row.metrics = {"wall_seconds": round(time.monotonic() - started, 3), **handle.metrics}
        row.log_tail = log_tail.replace("\x00", "")[-_LOG_TAIL_CHARS:] if log_tail else None
        self.session.commit()

    def run_tool(
        self, name: str, argv: Sequence[str | Path], *, timeout: float, env: Mapping[str, str] | None = None
    ) -> tools.ToolResult:
        """Chạy một công cụ ngoài như một bước; log nằm trong thư mục làm việc của job."""
        with self.step(name) as step:
            log_path = self.work_dir / f"{self._steps:02d}-{name}.log"
            try:
                result = tools.run_tool(
                    argv,
                    cwd=self.work_dir,
                    log_path=log_path,
                    timeout=timeout,
                    env=env,
                    allowed=self.allowed_tools,
                    stop=self.stop,
                )
            except tools.ToolStopped as error:
                step.log_tail = f"{error.log_tail}\n{type(error).__name__}: {error}"
                raise JobStopped(f"Job {self.job.id} is no longer running") from error
            except (tools.ToolFailed, tools.ToolTimeout) as error:
                step.log_tail = f"{error.log_tail}\n{type(error).__name__}: {str(error).splitlines()[0]}"
                raise
            step.metrics.update(result.metrics())
            step.log_tail = result.log_tail
            return result


Handler = Callable[[JobContext], dict[str, Any] | None]
