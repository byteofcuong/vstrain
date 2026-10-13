"""Một request ghi bị từ chối trước khi tới endpoint: thân của nó phải được đọc bỏ trước khi trả lời.

Không đọc thì server đóng kết nối trong lúc proxy còn đang gửi thân, và nginx có lúc trả 502 thay cho lời từ chối
của API (đo được 2 trong 160 request 4,5 MB). Test này gọi ứng dụng ở tầng ASGI để đếm được thân đã được đọc tới
đâu lúc câu trả lời bắt đầu.
"""

import asyncio

from app.main import MAX_BODY_BYTES, app

MEGABYTE = 1024 * 1024


def refused(headers: dict[str, str], chunks: list[bytes]) -> tuple[int, int]:
    """Gửi một POST có thân `chunks`; trả về mã trả lời và số khúc đã được đọc lúc câu trả lời bắt đầu."""
    pulled = 0
    seen: dict[str, int] = {}

    async def receive() -> dict:
        nonlocal pulled
        if pulled < len(chunks):
            pulled += 1
            return {"type": "http.request", "body": chunks[pulled - 1], "more_body": pulled < len(chunks)}
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        if message["type"] == "http.response.start":
            seen.update(status=message["status"], pulled=pulled)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/submissions",
        "raw_path": b"/api/submissions",
        "query_string": b"",
        "root_path": "",
        "headers": [(name.lower().encode(), value.encode()) for name, value in headers.items()],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }
    asyncio.run(app(scope, receive, send))
    return seen["status"], seen["pulled"]


def test_a_body_over_the_limit_is_read_to_its_end_before_the_refusal_is_sent():
    chunks = [b"A" * MEGABYTE] * 5
    headers = {"X-Requested-With": "vietstrain", "Content-Length": str(5 * MEGABYTE)}
    assert 5 * MEGABYTE > MAX_BODY_BYTES

    assert refused(headers, chunks) == (413, 5)


def test_the_body_of_a_request_without_the_csrf_header_is_read_before_the_refusal_too():
    chunks = [b"A" * MEGABYTE] * 3

    assert refused({"Content-Length": str(3 * MEGABYTE)}, chunks) == (403, 3)


def test_a_body_far_over_the_limit_is_not_read_at_all():
    # Đọc bỏ là để giữ kết nối với proxy sạch, không phải để ai đó bắt server nuốt cả gigabyte.
    chunks = [b"A" * MEGABYTE] * 4
    headers = {"X-Requested-With": "vietstrain", "Content-Length": str(1024 * MEGABYTE)}

    assert refused(headers, chunks) == (413, 0)


def test_a_body_of_undeclared_length_is_read_only_up_to_a_bound():
    chunks = [b"A" * MEGABYTE] * 40
    headers = {"X-Requested-With": "vietstrain", "Transfer-Encoding": "chunked"}

    status, pulled = refused(headers, chunks)

    assert status == 411
    assert 1 <= pulled <= 9
