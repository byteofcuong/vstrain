import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.accounts import service as accounts
from app.accounts.api import admin_router
from app.accounts.api import router as auth_router
from app.build.api import files_router
from app.build.api import router as datasets_router
from app.db import SessionDep
from app.errors import error_response, install_error_handlers, internal_error
from app.geo.api import router as units_router
from app.operations.api import router as operations_router
from app.samples.api import router as samples_router
from app.submissions.api import admin_router as sample_admin_router
from app.submissions.api import placements_router
from app.submissions.api import router as submissions_router

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Tính sẵn chuỗi băm dùng để so với email lạ, để lần đăng nhập đầu tiên không phải tự tính nó.
    accounts.unknown_email_hash()
    yield


app = FastAPI(
    title="VietStrain API",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)
install_error_handlers(app)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(sample_admin_router)
app.include_router(operations_router)
app.include_router(submissions_router)
app.include_router(samples_router)
app.include_router(datasets_router)
app.include_router(placements_router)
app.include_router(units_router)
app.include_router(files_router)


_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Câu trả lời ở các đường dẫn này nói về một tài khoản; trình duyệt và proxy không được giữ lại chúng.
_PRIVATE_PATHS = ("/api/auth/", "/api/admin/", "/api/submissions")
# Trần cho thân của một request ghi. Thứ lớn nhất API nhận là một file FASTA 2 MB bọc trong JSON.
MAX_BODY_BYTES = 4 * 1024 * 1024
# Thân của một request bị từ chối vẫn được đọc bỏ, tới chừng này byte, trước khi trả lời (xem `_discard_body`).
# nginx không chuyển thân trên 5 MB, nên qua nginx mọi thân bị từ chối đều được đọc hết.
_DISCARD_BYTES = 2 * MAX_BODY_BYTES


def _refuse_write(request: Request) -> Response | None:
    """Lý do từ chối một request ghi trước khi đọc thân của nó; `None` nếu được đi tiếp."""
    if not request.headers.get("x-requested-with"):
        return error_response(403, "CSRF_HEADER_REQUIRED", "Write requests must carry the X-Requested-With header")
    # Thân gửi từng khúc không báo trước độ dài, nên không chặn được trước khi đọc. Trình duyệt không gửi kiểu này.
    if "transfer-encoding" in request.headers:
        return error_response(411, "LENGTH_REQUIRED", "Write requests must declare their Content-Length")
    length = request.headers.get("content-length", "0")
    if not length.isascii() or not length.isdigit():
        return error_response(400, "BAD_REQUEST", "Content-Length is not a number")
    if int(length) > MAX_BODY_BYTES:
        return error_response(413, "BODY_TOO_LARGE", f"The request body is larger than {MAX_BODY_BYTES} bytes")
    return None


async def _discard_body(request: Request) -> None:
    """Đọc bỏ thân của một request sắp bị từ chối.

    Trả lời mà chưa đọc thân thì server đóng kết nối trong lúc proxy còn đang gửi, và nginx có lúc trả 502 thay
    cho lời từ chối này (đo được 2 trong 160 request 4,5 MB). Thân khai dài hơn `_DISCARD_BYTES` thì không đọc:
    việc này không được thành cách bắt server nhận cả gigabyte.
    """
    declared = request.headers.get("content-length", "")
    if declared.isascii() and declared.isdigit() and int(declared) > _DISCARD_BYTES:
        return
    seen = 0
    async for chunk in request.stream():
        seen += len(chunk)
        if seen > _DISCARD_BYTES:
            return


@app.middleware("http")
async def guard_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """Mọi request ghi phải mang header `X-Requested-With`, thứ frontend tự gắn.

    Trình duyệt chỉ cho một trang khác gắn header tự đặt sau khi hỏi server (preflight của CORS), mà API này không
    cho phép origin nào khác. Nhờ vậy một form hay script ở trang khác không mượn được cookie phiên để ghi.
    Kiểm tra này chạy trước mọi thứ khác: request bị từ chối ở đây không tới được bước kiểm tra mật khẩu.
    """
    refusal = None if request.method in _SAFE_METHODS else _refuse_write(request)
    if refusal is not None:
        await _discard_body(request)
        response: Response = refusal
    else:
        try:
            response = await call_next(request)
        except Exception:
            # Lỗi chưa lường trước được trả lời ngay ở đây, không để lớp ngoài cùng của framework trả: câu trả
            # lời của lớp đó không đi qua phần gắn header bên dưới.
            log.exception("Unhandled error in %s %s", request.method, request.url.path)
            response = internal_error()
    if request.url.path.startswith(_PRIVATE_PATHS):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health(response: Response, session: SessionDep) -> dict[str, str]:
    """Báo API còn sống và có nối được cơ sở dữ liệu hay không."""
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "db": "down"}
    return {"status": "ok", "db": "ok"}
