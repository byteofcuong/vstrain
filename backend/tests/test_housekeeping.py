import datetime as dt

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.accounts import passwords
from app.accounts import service as accounts
from app.config import Settings
from app.models import AuditLog, UserSession

NOW = dt.datetime(2026, 10, 13, 12, 0, tzinfo=dt.UTC)
YEAR = dt.timedelta(days=365)


def test_expired_sessions_and_old_audit_rows_are_removed_and_the_rest_is_kept(session, monkeypatch):
    monkeypatch.setattr(passwords, "N", 2**10)
    user = accounts.create_user(session, email="lab@example.org", display_name="Phòng A", password="mật khẩu đủ dài")
    session.query(AuditLog).delete()
    minute = dt.timedelta(minutes=1)

    def login(name: str, *, created: dt.timedelta, seen: dt.timedelta) -> None:
        session.add(
            UserSession(
                user_id=user.id, token_hash=name.ljust(64, "0"), created_at=NOW - created, last_seen_at=NOW - seen
            )
        )

    login("in-use", created=dt.timedelta(days=29), seen=minute)
    login("idle-just-under", created=dt.timedelta(days=8), seen=accounts.SESSION_IDLE - minute)
    login("idle-too-long", created=dt.timedelta(days=8), seen=accounts.SESSION_IDLE + minute)
    login("too-old-though-in-use", created=accounts.SESSION_LIFETIME + minute, seen=minute)
    for name, age in (("recent", dt.timedelta(days=1)), ("kept", YEAR - minute), ("old", YEAR + minute)):
        session.add(AuditLog(actor_id=user.id, action=name, at=NOW - age))
    session.flush()

    removed = accounts.purge_stale(session, now=NOW, audit_retention=YEAR)

    assert removed == {"sessions": 2, "audit_rows": 1}
    kept = sorted(token.rstrip("0") for token in session.scalars(select(UserSession.token_hash)))
    assert kept == ["idle-just-under", "in-use"]
    assert sorted(session.scalars(select(AuditLog.action))) == ["kept", "recent"]
    # Chạy lần nữa không còn gì để xoá.
    assert accounts.purge_stale(session, now=NOW, audit_retention=YEAR) == {"sessions": 0, "audit_rows": 0}


def test_a_retention_of_nothing_is_refused_instead_of_erasing_the_audit_log(session, monkeypatch):
    monkeypatch.setattr(passwords, "N", 2**10)
    user = accounts.create_user(session, email="lab@example.org", display_name="Phòng A", password="mật khẩu đủ dài")
    before = session.scalar(select(func.count()).select_from(AuditLog))
    assert before > 0 and user.id

    for retention in (dt.timedelta(0), dt.timedelta(days=-1)):
        with pytest.raises(ValueError, match="retention"):
            accounts.purge_stale(session, now=NOW, audit_retention=retention)
    assert session.scalar(select(func.count()).select_from(AuditLog)) == before
    # Cấu hình cũng không nhận giá trị đó.
    with pytest.raises(ValidationError):
        Settings(audit_retention_days=0)
    assert Settings(audit_retention_days=1).audit_retention_days == 1
