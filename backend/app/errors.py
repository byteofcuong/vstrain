"""Một dạng lỗi duy nhất cho mọi endpoint: `{"error": {"code", "message", "details"}}`.

`code` dành cho máy (giao diện dịch theo mã này), `message` dành cho người phát triển, `details` chỉ có khi lỗi
gắn với từng tham số.
"""

from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

INVALID_PARAMETERS = "Invalid request parameters"


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: list[dict[str, str]] | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def invalid_parameter(field: str, message: str) -> ApiError:
    """Lỗi 422 cho một tham số, cùng dạng với lỗi do FastAPI tự kiểm."""
    return ApiError(422, "VALIDATION_ERROR", INVALID_PARAMETERS, [{"field": field, "message": message}])


def error_response(
    status_code: int, code: str, message: str, details: list[dict[str, str]] | None = None
) -> JSONResponse:
    error: dict[str, object] = {"code": code, "message": message}
    if details:
        error["details"] = details
    return JSONResponse({"error": error}, status_code=status_code)


def internal_error() -> JSONResponse:
    """Câu trả lời cho lỗi chưa lường trước: chi tiết nằm trong log của server, không gửi cho người gọi.

    Middleware trong `app.main` bắt lỗi của mọi route và trả lời bằng hàm này.
    """
    return error_response(500, "INTERNAL_ERROR", "The server could not handle this request")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_request: Request, error: ApiError) -> JSONResponse:
        return error_response(error.status_code, error.code, error.message, error.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, error: RequestValidationError) -> JSONResponse:
        details = [{"field": str(item["loc"][-1]), "message": item["msg"]} for item in error.errors()]
        return error_response(422, "VALIDATION_ERROR", INVALID_PARAMETERS, details)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException) -> JSONResponse:
        # Lỗi do framework sinh ra (đường dẫn không tồn tại, sai phương thức) cũng theo cùng một dạng.
        return error_response(error.status_code, HTTPStatus(error.status_code).name, str(error.detail))
