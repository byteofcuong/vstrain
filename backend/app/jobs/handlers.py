"""Các loại job mà worker biết chạy. Tên loại job là khoá của `HANDLERS`."""

from typing import Any

from app.build.align import align_pending
from app.build.pipeline import build_dataset, republish_build
from app.jobs import queue
from app.jobs.steps import Handler, JobContext
from app.submissions.ingest import ingest_sample
from app.submissions.placement import place_pending

_VERSION_COMMANDS = {
    "augur": ["augur", "--version"],
    "nextclade": ["nextclade", "--version"],
    "iqtree": ["iqtree", "--version"],
}


def tool_versions(context: JobContext) -> dict[str, Any]:
    """Ghi phiên bản các công cụ sinh học trong image worker; dùng để kiểm tra worker sau khi triển khai."""
    context.check_params()
    versions = {}
    for tool, command in _VERSION_COMMANDS.items():
        result = context.run_tool(tool, command, timeout=60)
        versions[tool] = result.log_tail.strip().splitlines()[0]
    return versions


def build_then_place(context: JobContext) -> dict[str, Any]:
    """Dựng cây, rồi xếp việc gắn các mẫu đã nộp mà build mới chưa có vào cây của nó.

    Chỗ gắn tạm chỉ có nghĩa với cây của đúng một build, nên mỗi build mới phải gắn lại.
    """
    result = build_dataset(context)
    queue.enqueue(context.session, "place_pending", {"dataset": context.params["dataset"]}, priority=queue.INTERACTIVE)
    context.session.commit()
    return result


HANDLERS: dict[str, Handler] = {
    "align_pending": align_pending,
    "build_dataset": build_then_place,
    "ingest_sample": ingest_sample,
    "place_pending": place_pending,
    "publish_build": republish_build,
    "tool_versions": tool_versions,
}
