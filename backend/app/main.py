from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.accounts.api import admin_router
from app.accounts.api import router as auth_router
from app.build.api import files_router
from app.build.api import router as datasets_router
from app.db import SessionDep
from app.errors import error_response, install_error_handlers
from app.samples.api import router as samples_router

app = FastAPI(title="VietStrain API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
install_error_handlers(app)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(samples_router)
app.include_router(datasets_router)
app.include_router(files_router)


_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Câu trả lời ở các đường dẫn này nói về một tài khoản; trình duyệt và proxy không được giữ lại chúng.
_PRIVATE_PATHS = ("/api/auth/", "/api/admin/")


@app.middleware("http")
async def guard_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """Mọi request ghi phải mang header `X-Requested-With`, thứ frontend tự gắn.

    Trình duyệt chỉ cho một trang khác gắn header tự đặt sau khi hỏi server (preflight của CORS), mà API này không
    cho phép origin nào khác. Nhờ vậy một form hay script ở trang khác không mượn được cookie phiên để ghi.
    Kiểm tra này chạy trước mọi thứ khác: request bị từ chối ở đây không tới được bước kiểm tra mật khẩu.
    """
    if request.method not in _SAFE_METHODS and not request.headers.get("x-requested-with"):
        response: Response = error_response(
            403, "CSRF_HEADER_REQUIRED", "Write requests must carry the X-Requested-With header"
        )
    else:
        response = await call_next(request)
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
