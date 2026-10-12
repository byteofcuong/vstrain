"""Các loại job mà worker biết chạy. Tên loại job là khoá của `HANDLERS`."""

from typing import Any

from app.build.align import align_pending
from app.jobs.steps import Handler, JobContext

_VERSION_COMMANDS = {
    "augur": ["augur", "--version"],
    "nextclade": ["nextclade", "--version"],
    "iqtree": ["iqtree", "--version"],
}


def tool_versions(context: JobContext) -> dict[str, Any]:
    """Ghi phiên bản các công cụ sinh học trong image worker; dùng để kiểm tra worker sau khi triển khai."""
    versions = {}
    for tool, command in _VERSION_COMMANDS.items():
        result = context.run_tool(tool, command, timeout=60)
        versions[tool] = result.log_tail.strip().splitlines()[0]
    return versions


HANDLERS: dict[str, Handler] = {
    "align_pending": align_pending,
    "tool_versions": tool_versions,
}
