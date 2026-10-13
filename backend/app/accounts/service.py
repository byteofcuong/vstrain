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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.accounts.passwords import WeakPassword, check_policy, hash_password, same_password, verify_password
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


class WrongPassword(ValueError):
    """Mật khẩu hiện tại nhập không đúng."""


class TooManyAttempts(RuntimeError):
    """Tài khoản đang bị khoá tạm vì nhập sai mật khẩu quá nhiều lần."""


class SamePassword(ValueError):
    """Mật khẩu mới chính là mật khẩu đang dùng."""


class UserNotFound(LookupError):
    """Không có tài khoản mang mã này."""


class CannotLockSelf(RuntimeError):
    """Admin không tự khoá tài khoản mình đang dùng."""


class UseOwnPasswordForm(RuntimeError):
    """Mật khẩu của chính mình chỉ đổi được qua form cần mật khẩu hiện tại."""


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _is_email(email: str) -> bool:
    """Chuỗi đã chuẩn hoá có thể là email của một tài khoản không.

    Ký tự điều khiển và ký tự không in được bị loại ngay ở đây: PostgreSQL không nhận byte NUL, và nửa cặp
    surrogate lẻ không viết được thành UTF-8, nên chúng không được đi tới câu truy vấn.
    """
    return len(email) <= 254 and email.isprintable() and _EMAIL.fullmatch(email) is not None


def record(session: Session, actor_id: int | None, action: str, subject: str | None = None, **detail: Any) -> None:
    """Thêm một dòng nhật ký. Không bao giờ đưa mật khẩu hay token vào `detail`."""
    session.add(AuditLog(actor_id=actor_id, action=action, subject=subject, detail=detail))


def _is_name(name: str) -> bool:
    return 0 < len(name) <= 100 and name.isprintable()


def _is_role(role: str) -> bool:
    return role in {known.value for known in UserRole}


def account_problems(*, email: str, display_name: str, role: str, password: str) -> list[tuple[str, str]]:
    """Mọi lý do một tài khoản với các giá trị này không tạo được, mỗi lý do là (trường, mã). Không băm gì."""
    problems = []
    if not _is_email(normalize_email(email)):
        problems.append(("email", "INVALID_EMAIL"))
    if not _is_name(display_name.strip()):
        problems.append(("displayName", "INVALID_NAME"))
    if not _is_role(role):
        problems.append(("role", "UNKNOWN_ROLE"))
    try:
        check_policy(password)
    except WeakPassword:
        problems.append(("password", "WEAK_PASSWORD"))
    return problems


def create_user(
    session: Session,
    *,
    email: str,
    display_name: str,
    password: str,
    role: str = UserRole.SUBMITTER.value,
    created_by: int | None = None,
) -> AppUser:
    """Tạo một tài khoản. `created_by` là admin đã tạo nó; để trống khi tạo từ dòng lệnh."""
    email = normalize_email(email)
    name = display_name.strip()
    if not _is_email(email):
        raise ValueError("Not an email address")
    if not _is_role(role):
        raise ValueError(f"Unknown role {role!r}")
    if not _is_name(name):
        raise ValueError("The display name must be 1 to 100 characters of readable text")
    if session.scalar(select(AppUser.id).where(AppUser.email == email)) is not None:
        raise EmailTaken(f"There is already an account for {email}")
    user = AppUser(email=email, display_name=name, password_hash=hash_password(password), role=role)
    try:
        # Savepoint: nếu database từ chối dòng này thì chỉ việc thêm nó bị huỷ, session của bên gọi vẫn dùng được.
        with session.begin_nested():
            session.add(user)
            session.flush()
    except IntegrityError:
        # Một lần tạo khác cho cùng email đã commit sau bước kiểm tra ở trên.
        if session.scalar(select(AppUser.id).where(AppUser.email == email)) is None:
            raise
        raise EmailTaken(f"There is already an account for {email}") from None
    record(session, created_by, "user_created", f"user:{user.id}", role=role)
    session.flush()
    return user


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@functools.cache
def unknown_email_hash() -> str:
    """Chuỗi băm của một mật khẩu không ai biết, để email không tồn tại cũng tốn một lần băm như email có thật.

    Tính một lần rồi giữ lại. API gọi hàm này lúc khởi động: nếu để lần đăng nhập đầu tiên với email lạ tự tính
    thì lần đó tốn hai lần băm, và độ chậm ấy nói rằng email không có tài khoản.
    """
    return hash_password(secrets.token_urlsafe(32))


def _count_wrong_password(
    session: Session, user: AppUser, now: dt.datetime, action: str, subject: str | None = None
) -> None:
    """Ghi nhận một lần nhập sai mật khẩu của `user`; đủ số lần trong cửa sổ thì khoá tài khoản một lúc.

    Đăng nhập và form đổi mật khẩu dùng chung bộ đếm này: người cầm được một phiên không có chỗ nào để dò mật
    khẩu mà không bị đếm.
    """
    if user.failed_since is None or now - user.failed_since > FAILURE_WINDOW:
        user.failed_since, user.failed_logins = now, 0
    user.failed_logins += 1
    if user.failed_logins >= MAX_FAILURES:
        user.locked_until = now + LOCK_TIME
        user.failed_since, user.failed_logins = None, 0
        record(session, user.id, "login_locked", subject)
    else:
        record(session, user.id, action, subject)
    session.flush()


def log_in(session: Session, email: str, password: str, *, now: dt.datetime) -> tuple[AppUser, str] | None:
    """Đăng nhập: trả về tài khoản và token của phiên mới, hoặc `None`.

    Mọi lý do thất bại (email lạ, sai mật khẩu, đang bị khoá) cho cùng một kết quả, cùng một lần băm và cùng
    một dòng nhật ký, để câu trả lời và thời gian trả lời không cho biết email nào có tài khoản. Nhật ký không
    ghi email đã thử: người dùng hay gõ nhầm mật khẩu vào ô email.

    Bên gọi giữ `passwords.hashing_slot()` quanh lời gọi này và lần commit theo sau: khoá dòng dưới đây chỉ
    được chờ bởi số lần đăng nhập có trần, không phải bởi mọi request đang tới.
    """
    email = normalize_email(email)
    # Khoá dòng: các lần thử chạy song song không vượt được bộ đếm số lần sai.
    locked_row = select(AppUser).where(AppUser.email == email).with_for_update()
    user = session.scalar(locked_row) if _is_email(email) else None
    if user is None:
        verify_password(password, unknown_email_hash())
        record(session, None, "login_failed")
        session.flush()
        return None
    correct = verify_password(password, user.password_hash)
    if user.locked_until is not None and user.locked_until > now:
        # Đang khoá: lần thử này không được tính thêm và không kéo dài thời gian khoá.
        record(session, user.id, "login_refused")
        session.flush()
        return None
    if not correct:
        _count_wrong_password(session, user, now, "login_failed")
        return None
    if user.is_locked:
        record(session, user.id, "login_refused")
        session.flush()
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


def purge_stale(session: Session, *, now: dt.datetime, audit_retention: dt.timedelta) -> dict[str, int]:
    """Xoá phiên đã hết hạn và dòng nhật ký cũ hơn `audit_retention`; trả về số dòng đã xoá của mỗi loại.

    Phiên hết hạn vốn đã không dùng được; trước đây chúng chỉ bị xoá khi chính tài khoản đó đăng nhập lại.
    """
    if audit_retention <= dt.timedelta(0):
        raise ValueError("The audit log must be kept for some time; a retention of zero would erase all of it")
    expired = or_(UserSession.last_seen_at < now - SESSION_IDLE, UserSession.created_at < now - SESSION_LIFETIME)
    sessions = session.execute(delete(UserSession).where(expired)).rowcount
    audit_rows = session.execute(delete(AuditLog).where(AuditLog.at < now - audit_retention)).rowcount
    session.flush()
    return {"sessions": sessions, "audit_rows": audit_rows}


def change_password(
    session: Session, user_id: int, keep_token: str | None, *, current: str, new: str, now: dt.datetime
) -> None:
    """Người dùng tự đổi mật khẩu: phải đưa đúng mật khẩu hiện tại. Chỉ flush.

    Đổi xong, mọi phiên khác của tài khoản bị kết thúc; phiên mang `keep_token` được giữ. Ném `TooManyAttempts`,
    `WrongPassword` (lần sai đã được đếm: bên gọi phải commit), `WeakPassword` hoặc `SamePassword`.
    Bên gọi giữ `passwords.hashing_slot()` quanh lời gọi này, như với `log_in`.
    """
    user = _account(session, user_id)
    subject = f"user:{user.id}"
    if user.locked_until is not None and user.locked_until > now:
        # Đang khoá vì nhập sai nhiều lần: không thử mật khẩu, không đếm thêm, không kéo dài thời gian khoá.
        record(session, user.id, "password_change_refused", subject)
        session.flush()
        raise TooManyAttempts("Too many wrong passwords; try again later")
    if not verify_password(current, user.password_hash):
        _count_wrong_password(session, user, now, "password_change_failed", subject)
        raise WrongPassword("The current password is wrong")
    check_policy(new)
    if same_password(new, current):
        raise SamePassword("The new password is the one already in use")

    user.password_hash = hash_password(new)
    user.failed_since, user.failed_logins, user.locked_until = None, 0, None
    others = delete(UserSession).where(UserSession.user_id == user.id)
    if keep_token:
        others = others.where(UserSession.token_hash != _token_hash(keep_token))
    session.execute(others)
    record(session, user.id, "password_changed", subject)
    session.flush()


def _account(session: Session, user_id: int) -> AppUser:
    """Tài khoản mang mã này, với dòng của nó đã được khoá và các cột được đọc lại sau khi có khoá.

    Session của request thường đã nạp chính tài khoản này từ trước (để biết ai đang gọi). Không đọc lại thì bộ đếm
    số lần sai và thời hạn khoá là của lúc chưa chờ khoá: các request chạy song song cùng đếm từ một số cũ.
    """
    locked_row = select(AppUser).where(AppUser.id == user_id).with_for_update()
    user = session.scalar(locked_row.execution_options(populate_existing=True))
    if user is None:
        raise UserNotFound(f"No account with id {user_id}")
    return user


def set_locked(session: Session, actor: AppUser, user_id: int, *, locked: bool) -> None:
    """Admin khoá hoặc mở khoá một tài khoản. Chỉ flush.

    Khoá thì mọi phiên của tài khoản kết thúc ngay. Mở khoá cũng gỡ luôn việc khoá tạm vì nhập sai mật khẩu.
    Làm lại việc đã làm rồi thì không ghi thêm nhật ký.
    """
    user = _account(session, user_id)
    if locked and user.id == actor.id:
        raise CannotLockSelf("An administrator cannot lock the account in use")
    if locked:
        session.execute(delete(UserSession).where(UserSession.user_id == user.id))
        if not user.is_locked:
            user.is_locked = True
            record(session, actor.id, "user_locked", f"user:{user.id}")
    elif user.is_locked or user.locked_until is not None or user.failed_logins:
        user.is_locked = False
        user.failed_since, user.failed_logins, user.locked_until = None, 0, None
        record(session, actor.id, "user_unlocked", f"user:{user.id}")
    session.flush()


def reset_password(session: Session, actor: AppUser, user_id: int, password: str) -> None:
    """Admin đặt mật khẩu mới cho một tài khoản khác; mọi phiên của tài khoản đó kết thúc. Chỉ flush.

    Việc khoá tạm vì nhập sai được gỡ, để mật khẩu mới dùng được ngay; việc khoá do admin thì giữ nguyên.
    """
    user = _account(session, user_id)
    if user.id == actor.id:
        raise UseOwnPasswordForm("Change your own password with the form that asks for the current one")
    user.password_hash = hash_password(password)
    user.failed_since, user.failed_logins, user.locked_until = None, 0, None
    session.execute(delete(UserSession).where(UserSession.user_id == user.id))
    record(session, actor.id, "password_reset", f"user:{user.id}")
    session.flush()
