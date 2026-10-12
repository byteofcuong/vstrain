"""Tài khoản và phiên đăng nhập.

Các hàm ở đây chỉ flush; bên gọi (API, CLI) quyết định lúc commit. Thời điểm hiện tại được truyền vào để test
đặt được đồng hồ.
"""

import datetime as dt
import functools
import hashlib
import re
import secrets
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.accounts.passwords import hash_password, verify_password
from app.models import AppUser, AuditLog, UserRole, UserSession

# Phiên hết hạn sau 7 ngày không dùng, và muộn nhất 30 ngày sau lúc đăng nhập dù vẫn đang dùng.
SESSION_IDLE = dt.timedelta(days=7)
SESSION_LIFETIME = dt.timedelta(days=30)
# Không ghi `last_seen_at` ở mọi request: một phút một lần là đủ chính xác cho hạn 7 ngày.
TOUCH_EVERY = dt.timedelta(minutes=1)

# Đủ 5 lần sai mật khẩu liên tiếp trong 15 phút thì tài khoản bị khoá 15 phút.
MAX_FAILURES = 5
FAILURE_WINDOW = dt.timedelta(minutes=15)
LOCK_TIME = dt.timedelta(minutes=15)

_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class EmailTaken(ValueError):
    """Đã có tài khoản dùng email này."""


def normalize_email(email: str) -> str:
    return email.strip().lower()


def record(session: Session, actor_id: int | None, action: str, subject: str | None = None, **detail: Any) -> None:
    """Thêm một dòng nhật ký. Không bao giờ đưa mật khẩu hay token vào `detail`."""
    session.add(AuditLog(actor_id=actor_id, action=action, subject=subject, detail=detail))


def create_user(
    session: Session, *, email: str, display_name: str, password: str, role: str = UserRole.SUBMITTER.value
) -> AppUser:
    email = normalize_email(email)
    name = display_name.strip()
    if not _EMAIL.fullmatch(email) or len(email) > 254:
        raise ValueError("Not an email address")
    if role not in {known.value for known in UserRole}:
        raise ValueError(f"Unknown role {role!r}")
    if not 0 < len(name) <= 100:
        raise ValueError("The display name must have between 1 and 100 characters")
    if session.scalar(select(AppUser.id).where(AppUser.email == email)) is not None:
        raise EmailTaken(f"There is already an account for {email}")
    user = AppUser(email=email, display_name=name, password_hash=hash_password(password), role=role)
    session.add(user)
    session.flush()
    record(session, None, "user_created", f"user:{user.id}", role=role)
    session.flush()
    return user


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@functools.cache
def _dummy_hash() -> str:
    """Chuỗi băm của một mật khẩu không ai biết, để email không tồn tại cũng tốn một lần băm như email có thật."""
    return hash_password(secrets.token_urlsafe(32))


def log_in(session: Session, email: str, password: str, *, now: dt.datetime) -> tuple[AppUser, str] | None:
    """Đăng nhập: trả về tài khoản và token của phiên mới, hoặc `None`.

    Mọi lý do thất bại (email lạ, sai mật khẩu, đang bị khoá) cho cùng một kết quả và cùng một lần băm, để câu
    trả lời và thời gian trả lời không cho biết email nào có tài khoản.
    """
    # Khoá dòng: các lần thử chạy song song không vượt được bộ đếm số lần sai.
    user = session.scalar(select(AppUser).where(AppUser.email == normalize_email(email)).with_for_update())
    if user is None:
        verify_password(password, _dummy_hash())
        return None
    correct = verify_password(password, user.password_hash)
    if user.locked_until is not None and user.locked_until > now:
        return None
    if not correct:
        if user.failed_since is None or now - user.failed_since > FAILURE_WINDOW:
            user.failed_since, user.failed_logins = now, 0
        user.failed_logins += 1
        if user.failed_logins >= MAX_FAILURES:
            user.locked_until = now + LOCK_TIME
            user.failed_since, user.failed_logins = None, 0
            record(session, user.id, "login_locked")
        else:
            record(session, user.id, "login_failed")
        session.flush()
        return None
    if user.is_locked:
        return None

    user.failed_since, user.failed_logins, user.locked_until = None, 0, None
    expired = or_(UserSession.last_seen_at < now - SESSION_IDLE, UserSession.created_at < now - SESSION_LIFETIME)
    session.execute(delete(UserSession).where(UserSession.user_id == user.id, expired))
    # 256 bit ngẫu nhiên; mỗi lần đăng nhập một token mới, không dùng lại token cũ.
    token = secrets.token_urlsafe(32)
    session.add(UserSession(user_id=user.id, token_hash=_token_hash(token), created_at=now, last_seen_at=now))
    record(session, user.id, "login")
    session.flush()
    return user, token


def session_user(session: Session, token: str, *, now: dt.datetime) -> AppUser | None:
    """Tài khoản của một phiên còn hiệu lực; ghi nhận rằng phiên vừa được dùng."""
    row = session.execute(
        select(UserSession, AppUser)
        .join(AppUser, AppUser.id == UserSession.user_id)
        .where(UserSession.token_hash == _token_hash(token))
    ).first()
    if row is None:
        return None
    stored, user = row
    if user.is_locked or now - stored.last_seen_at > SESSION_IDLE or now - stored.created_at > SESSION_LIFETIME:
        return None
    if now - stored.last_seen_at > TOUCH_EVERY:
        stored.last_seen_at = now
        session.flush()
    return user


def log_out(session: Session, token: str) -> None:
    """Xoá phiên ở server, để token không còn dùng được dù ai đó vẫn giữ cookie."""
    stored = session.scalar(select(UserSession).where(UserSession.token_hash == _token_hash(token)))
    if stored is None:
        return
    record(session, stored.user_id, "logout")
    session.delete(stored)
    session.flush()
