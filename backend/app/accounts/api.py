"""Đăng nhập, đăng xuất, và hai dependency kiểm tra quyền dùng chung cho mọi endpoint cần đăng nhập."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Path, Response
from pydantic import Field
from sqlalchemy import select

from app.accounts import passwords, service
from app.apimodel import ApiModel
from app.config import settings
from app.db import SessionDep
from app.errors import INVALID_PARAMETERS, ApiError
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


class WhoIsHere(ApiModel):
    user: UserOut | None  # `null` là khách


class Credentials(ApiModel):
    email: str = Field(max_length=254)
    # Giới hạn ngay ở đây: chuỗi dài hơn mọi mật khẩu được nhận (kể cả ở dạng dấu rời) không tới được bước băm.
    password: str = Field(max_length=passwords.RAW_LIMIT)


class PasswordChange(ApiModel):
    current_password: str = Field(max_length=passwords.RAW_LIMIT)
    new_password: str = Field(max_length=passwords.RAW_LIMIT)


class AccountOut(ApiModel):
    """Một tài khoản như admin thấy nó. Không có chuỗi băm mật khẩu."""

    id: int
    email: str
    display_name: str
    role: str
    is_locked: bool
    created_at: dt.datetime


class AccountList(ApiModel):
    items: list[AccountOut]


class AccountIn(ApiModel):
    """Giới hạn ở đây chỉ chặn thứ quá cỡ; quy tắc thật nằm ở `service.account_problems`, mỗi lỗi một mã."""

    email: str = Field(max_length=1000)
    display_name: str = Field(max_length=1000)
    role: str = Field(max_length=100)
    password: str = Field(max_length=passwords.RAW_LIMIT)


class NewPassword(ApiModel):
    password: str = Field(max_length=passwords.RAW_LIMIT)


# Mã tài khoản là BIGINT: số lớn hơn thế bị từ chối ở đây, không tới được database.
UserId = Annotated[int, Path(ge=1, le=2**63 - 1)]


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _session_user(session: SessionDep, token: str | None) -> AppUser | None:
    user = service.session_user(session, token, now=_now()) if token else None
    # Lưu lại lần dùng phiên vừa ghi nhận.
    session.commit()
    return user


def current_user(session: SessionDep, token: SessionToken = None) -> AppUser:
    """Tài khoản đang đăng nhập; 401 nếu không có phiên còn hiệu lực."""
    user = _session_user(session, token)
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
        # Giữ một chỗ băm cho cả lần đăng nhập, từ trước câu truy vấn đầu tiên tới sau khi commit. Lần đang chờ
        # tới lượt chưa mở transaction nên không giữ kết nối database, và số lần cùng chờ khoá của một dòng
        # tài khoản không vượt quá số chỗ chạy.
        with passwords.hashing_slot():
            result = service.log_in(session, body.email, body.password, now=_now())
            # Commit cả khi thất bại: số lần sai phải được lưu thì giới hạn số lần thử mới có nghĩa.
            session.commit()
    except passwords.TooBusy:
        # Quá nhiều lần đăng nhập cùng lúc: từ chối ngay, không tính là một lần sai, chưa có gì được ghi.
        raise ApiError(503, "LOGIN_BUSY", "Too many logins are being checked; try again in a moment") from None
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
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=settings.cookie_secure)


@router.get("/me")
def me(user: CurrentUser) -> Me:
    return Me(user=UserOut.model_validate(user))


@router.get("/session")
def who_is_here(session: SessionDep, token: SessionToken = None) -> WhoIsHere:
    """Ai đang dùng trang: tài khoản đang đăng nhập, hoặc `null` với khách.

    Trang nào mở ra cũng hỏi câu này, và với khách thì không có gì sai: câu trả lời là 200. Dùng `/me` cho việc
    đó thì trình duyệt ghi một dòng lỗi 401 vào console của mọi người xem. Endpoint này không thay cho việc kiểm
    tra quyền; mỗi endpoint cần đăng nhập vẫn tự kiểm tra.
    """
    user = _session_user(session, token)
    return WhoIsHere(user=UserOut.model_validate(user) if user else None)


def _problem(field: str, code: str, message: str) -> ApiError:
    return ApiError(422, "VALIDATION_ERROR", INVALID_PARAMETERS, [{"field": field, "code": code, "message": message}])


_BUSY = (503, "LOGIN_BUSY", "Too many passwords are being checked; try again in a moment")


@router.post("/password", status_code=204)
def change_password(body: PasswordChange, user: CurrentUser, session: SessionDep, token: SessionToken = None) -> None:
    """Đổi mật khẩu của chính mình. Cần mật khẩu hiện tại; đổi xong, các phiên khác của tài khoản kết thúc."""
    try:
        # Giữ một chỗ băm quanh cả việc này, như với đăng nhập: hàng chờ khoá dòng tài khoản cũng nằm trong trần.
        with passwords.hashing_slot():
            try:
                service.change_password(
                    session, user.id, token, current=body.current_password, new=body.new_password, now=_now()
                )
            except (service.WrongPassword, service.TooManyAttempts):
                # Lần nhập sai phải được lưu thì bộ đếm mới có nghĩa. Lỗi nào khác thì không commit gì.
                session.commit()
                raise
            session.commit()
    except passwords.TooBusy:
        raise ApiError(*_BUSY) from None
    except service.TooManyAttempts:
        raise ApiError(429, "TOO_MANY_ATTEMPTS", "Too many wrong passwords; try again in a while") from None
    except service.WrongPassword:
        raise ApiError(403, "WRONG_PASSWORD", "The current password is wrong") from None
    except passwords.WeakPassword as error:
        raise _problem("newPassword", "WEAK_PASSWORD", str(error)) from None
    except service.SamePassword as error:
        raise _problem("newPassword", "SAME_PASSWORD", str(error)) from None


@admin_router.get("/users")
def list_users(_admin: AdminUser, session: SessionDep) -> AccountList:
    users = session.scalars(select(AppUser).order_by(AppUser.email))
    return AccountList(items=[AccountOut.model_validate(user) for user in users])


@admin_router.post("/users", status_code=201)
def create_user(body: AccountIn, admin: AdminUser, session: SessionDep) -> AccountOut:
    """Tạo một tài khoản với mật khẩu ban đầu do admin đặt; người dùng tự đổi sau lần đăng nhập đầu."""
    problems = service.account_problems(
        email=body.email, display_name=body.display_name, role=body.role, password=body.password
    )
    if problems:
        details = [{"field": field, "code": code, "message": "Not acceptable"} for field, code in problems]
        raise ApiError(422, "VALIDATION_ERROR", INVALID_PARAMETERS, details)
    try:
        user = service.create_user(
            session,
            email=body.email,
            display_name=body.display_name,
            password=body.password,
            role=body.role,
            created_by=admin.id,
        )
    except service.EmailTaken:
        raise ApiError(409, "EMAIL_TAKEN", "There is already an account for this email") from None
    except passwords.TooBusy:
        raise ApiError(*_BUSY) from None
    session.commit()
    return AccountOut.model_validate(user)


def _set_locked(session: SessionDep, admin: AppUser, user_id: int, *, locked: bool) -> None:
    try:
        service.set_locked(session, admin, user_id, locked=locked)
    except service.UserNotFound:
        raise ApiError(404, "USER_NOT_FOUND", "No account with this id") from None
    except service.CannotLockSelf:
        raise ApiError(409, "CANNOT_LOCK_SELF", "You cannot lock the account you are using") from None
    session.commit()


@admin_router.post("/users/{user_id}/lock", status_code=204)
def lock_user(user_id: UserId, admin: AdminUser, session: SessionDep) -> None:
    """Khoá một tài khoản: nó không đăng nhập được nữa, và mọi phiên của nó kết thúc ngay."""
    _set_locked(session, admin, user_id, locked=True)


@admin_router.post("/users/{user_id}/unlock", status_code=204)
def unlock_user(user_id: UserId, admin: AdminUser, session: SessionDep) -> None:
    """Mở khoá một tài khoản; cũng gỡ việc khoá tạm vì nhập sai mật khẩu nhiều lần."""
    _set_locked(session, admin, user_id, locked=False)


@admin_router.post("/users/{user_id}/password", status_code=204)
def reset_password(user_id: UserId, body: NewPassword, admin: AdminUser, session: SessionDep) -> None:
    """Đặt mật khẩu mới cho một tài khoản khác; mọi phiên của tài khoản đó kết thúc."""
    try:
        service.reset_password(session, admin, user_id, body.password)
    except service.UserNotFound:
        raise ApiError(404, "USER_NOT_FOUND", "No account with this id") from None
    except service.UseOwnPasswordForm:
        raise ApiError(
            409, "USE_OWN_PASSWORD_FORM", "Change your own password with the form that asks for the current one"
        ) from None
    except passwords.WeakPassword as error:
        raise _problem("password", "WEAK_PASSWORD", str(error)) from None
    except passwords.TooBusy:
        raise ApiError(*_BUSY) from None
    session.commit()
