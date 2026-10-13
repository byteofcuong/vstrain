"""Đăng nhập, đăng xuất, và hai dependency kiểm tra quyền dùng chung cho mọi endpoint cần đăng nhập."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response
from pydantic import Field
from sqlalchemy import select

from app.accounts import passwords, service
from app.apimodel import ApiModel
from app.config import settings
from app.db import SessionDep
from app.errors import ApiError
from app.models import AppUser, UserRole

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"])

SESSION_COOKIE = "vs_session"
SessionToken = Annotated[str | None, Cookie(alias=SESSION_COOKIE)]


class UserOut(ApiModel):
    """Những gì về một tài khoản được phép rời server. Không có chuỗi băm mật khẩu."""

    email: str
    display_name: str
    role: str


class Me(ApiModel):
    user: UserOut


class Credentials(ApiModel):
    email: str = Field(max_length=254)
    # Giới hạn ngay ở đây: chuỗi dài hơn mọi mật khẩu được nhận (kể cả ở dạng dấu rời) không tới được bước băm.
    password: str = Field(max_length=passwords.RAW_LIMIT)


class UserList(ApiModel):
    items: list[UserOut]


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def current_user(session: SessionDep, token: SessionToken = None) -> AppUser:
    """Tài khoản đang đăng nhập; 401 nếu không có phiên còn hiệu lực."""
    user = service.session_user(session, token, now=_now()) if token else None
    # Lưu lại lần dùng phiên vừa ghi nhận.
    session.commit()
    if user is None:
        raise ApiError(401, "NOT_AUTHENTICATED", "Log in to use this")
    return user


CurrentUser = Annotated[AppUser, Depends(current_user)]


def require_admin(user: CurrentUser) -> AppUser:
    if user.role != UserRole.ADMIN.value:
        raise ApiError(403, "FORBIDDEN", "Only an administrator can do this")
    return user


AdminUser = Annotated[AppUser, Depends(require_admin)]


@router.post("/login")
def login(body: Credentials, response: Response, session: SessionDep) -> Me:
    try:
        result = service.log_in(session, body.email, body.password, now=_now())
    except passwords.TooBusy:
        # Quá nhiều lần đăng nhập cùng lúc: từ chối ngay, không tính là một lần sai. Lúc này chưa có gì được
        # ghi; khoá trên dòng tài khoản được nhả khi session của request đóng lại.
        raise ApiError(503, "LOGIN_BUSY", "Too many logins are being checked; try again in a moment") from None
    # Commit cả khi thất bại: số lần sai phải được lưu thì giới hạn số lần thử mới có nghĩa.
    session.commit()
    if result is None:
        raise ApiError(
            401, "INVALID_CREDENTIALS", "Wrong email or password, or the account is locked after too many attempts"
        )
    user, token = result
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(service.SESSION_LIFETIME.total_seconds()),
        httponly=True,  # JavaScript của trang không đọc được token
        samesite="lax",  # trang khác không gửi kèm được cookie trong request ghi
        secure=settings.cookie_secure,
        path="/",
    )
    return Me(user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
def logout(response: Response, session: SessionDep, token: SessionToken = None) -> None:
    if token:
        service.log_out(session, token)
        session.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me")
def me(user: CurrentUser) -> Me:
    return Me(user=UserOut.model_validate(user))


@admin_router.get("/users")
def list_users(_admin: AdminUser, session: SessionDep) -> UserList:
    users = session.scalars(select(AppUser).order_by(AppUser.email))
    return UserList(items=[UserOut.model_validate(user) for user in users])
