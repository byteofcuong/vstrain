"""Chỗ duy nhất trong hệ thống được phép chạy tiến trình ngoài.

Augur ghép lệnh thành một chuỗi rồi đưa cho bash (`augur/io/shell_command_runner.py`), nên một tham số như
`--tree-builder-args "...; touch x"` chạy được lệnh tuỳ ý. Ở đây lệnh luôn là một danh sách đối số, không có
shell nào đứng giữa, và chỉ những công cụ có tên trong danh sách cho phép mới được chạy.
"""

import os
import shutil
import signal
import subprocess
import threading
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

ALLOWED_TOOLS = frozenset({"augur", "nextclade", "iqtree"})

_SEARCH_PATH = "/usr/local/bin:/usr/bin:/bin"
_LOG_TAIL_BYTES = 4000


@dataclass(frozen=True)
class ToolResult:
    argv: tuple[str, ...]
    exit_code: int
    wall_seconds: float
    cpu_seconds: float  # user + system, của tiến trình và các tiến trình con nó đã chờ
    max_rss_mb: float
    log_path: Path
    log_tail: str

    def metrics(self) -> dict[str, float]:
        return {
            "wall_seconds": round(self.wall_seconds, 3),
            "cpu_seconds": round(self.cpu_seconds, 3),
            "max_rss_mb": round(self.max_rss_mb, 1),
        }


class ToolError(Exception):
    pass


class ToolNotAllowed(ToolError):
    pass


class ToolTimeout(ToolError):
    pass


class ToolFailed(ToolError):
    def __init__(self, tool: str, exit_code: int, log_tail: str) -> None:
        super().__init__(f"{tool} exited with code {exit_code}\n{log_tail}")
        self.exit_code = exit_code
        self.log_tail = log_tail


def _executable(tool: str, allowed: frozenset[str]) -> str:
    # So nguyên tên: đường dẫn hay tên có khoảng trắng đều không khớp, kể cả khi trỏ tới công cụ hợp lệ.
    if tool not in allowed:
        raise ToolNotAllowed(f"Tool {tool!r} is not in the allowlist {sorted(allowed)}")
    path = shutil.which(tool, path=_SEARCH_PATH)
    if path is None:
        raise ToolNotAllowed(f"Tool {tool!r} is allowed but not installed in this image")
    return path


def _tail(log_path: Path) -> str:
    with log_path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        handle.seek(max(0, handle.tell() - _LOG_TAIL_BYTES))
        return handle.read().decode("utf-8", errors="replace")


def run_tool(
    argv: Sequence[str | Path],
    *,
    cwd: Path,
    log_path: Path,
    timeout: float,
    env: Mapping[str, str] | None = None,
    allowed: frozenset[str] = ALLOWED_TOOLS,
) -> ToolResult:
    """Chạy một công cụ và chờ nó xong; ghi stdout và stderr vào `log_path`.

    Ném `ToolNotAllowed` trước khi chạy, `ToolTimeout` khi quá `timeout` giây, `ToolFailed` khi mã thoát khác 0.
    """
    arguments = [str(argument) for argument in argv]
    if not arguments:
        raise ToolNotAllowed("Empty command")
    if any("\0" in argument for argument in arguments):
        raise ValueError("Arguments must not contain NUL bytes")
    command = [_executable(arguments[0], allowed), *arguments[1:]]

    # Tiến trình con không thừa hưởng môi trường của worker, nơi có URL và mật khẩu database.
    environment = {"PATH": _SEARCH_PATH, "HOME": str(cwd), "LANG": "C.UTF-8", **(env or {})}

    timed_out = threading.Event()
    started = time.monotonic()
    with log_path.open("wb") as log:
        process = subprocess.Popen(  # noqa: S603 - danh sách đối số, không qua shell
            command,
            cwd=cwd,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # nhóm tiến trình riêng, để dừng được cả các tiến trình con
        )

        def kill_group() -> None:
            timed_out.set()
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

        watchdog = threading.Timer(timeout, kill_group)
        watchdog.start()
        try:
            # wait4 trả kèm số đo tài nguyên của đúng tiến trình này, thứ mà Popen.wait không có.
            _, status, usage = os.wait4(process.pid, 0)
        finally:
            watchdog.cancel()
        process.returncode = os.waitstatus_to_exitcode(status)

    result = ToolResult(
        argv=tuple(arguments),
        exit_code=process.returncode,
        wall_seconds=time.monotonic() - started,
        cpu_seconds=usage.ru_utime + usage.ru_stime,
        max_rss_mb=usage.ru_maxrss / 1024,  # Linux báo theo kilobyte
        log_path=log_path,
        log_tail=_tail(log_path),
    )
    if timed_out.is_set():
        raise ToolTimeout(f"{arguments[0]} did not finish within {timeout:g} seconds")
    if result.exit_code != 0:
        raise ToolFailed(arguments[0], result.exit_code, result.log_tail)
    return result
