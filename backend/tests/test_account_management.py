"""Đổi mật khẩu của chính mình, và việc admin tạo, khoá, mở khoá tài khoản và đặt lại mật khẩu."""

import datetime as dt
import unicodedata

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import sessionmaker

from app.accounts import passwords, service
from app.models import AppUser, AuditLog, UserSession

EMAIL = "lab@example.org"
ADMIN_EMAIL = "admin@example.org"
PASSWORD = "mật khẩu đủ dài"
NEW_PASSWORD = "một mật khẩu khác hẳn"
COOKIE = "vs_session"
BROWSER = {"X-Requested-With": "vietstrain"}


@pytest.fixture(autouse=True)
def cheap_hashing(monkeypatch):
    monkeypatch.setattr(passwords, "N", 2**10)
    service.unknown_email_hash.cache_clear()
    yield
    service.unknown_email_hash.cache_clear()


@pytest.fixture
def user(session) -> AppUser:
    return service.create_user(session, email=EMAIL, display_name="Phòng xét nghiệm A", password=PASSWORD)


@pytest.fixture
def admin(session) -> AppUser:
    return service.create_user(session, email=ADMIN_EMAIL, display_name="Quản trị", password=PASSWORD, role="admin")


def log_in(client, email: str = EMAIL, password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password}, headers=BROWSER)


def change(client, current: str = PASSWORD, new: str = NEW_PASSWORD, headers: dict | None = BROWSER):
    return client.post("/api/auth/password", json={"currentPassword": current, "newPassword": new}, headers=headers)


def error_of(response) -> tuple[int, str]:
    return response.status_code, response.json()["error"]["code"]


def problems(response) -> list[tuple[str, str]]:
    return [(detail["field"], detail["code"]) for detail in response.json()["error"]["details"]]


def actions(session) -> list[tuple[str, int | None, str | None]]:
    rows = session.execute(select(AuditLog.action, AuditLog.actor_id, AuditLog.subject).order_by(AuditLog.id))
    return [tuple(row) for row in rows]


def audit_text(session) -> str:
    return repr(session.execute(select(AuditLog.action, AuditLog.subject, AuditLog.detail)).all())


# --- Người dùng tự đổi mật khẩu ---


def test_after_a_change_the_new_password_logs_in_and_the_old_one_does_not(client, session, user):
    log_in(client)

    response = change(client)

    assert (response.status_code, response.content) == (204, b"")
    client.post("/api/auth/logout", headers=BROWSER)
    assert error_of(log_in(client)) == (401, "INVALID_CREDENTIALS")
    assert log_in(client, password=NEW_PASSWORD).status_code == 200
    assert ("password_changed", user.id, f"user:{user.id}") in actions(session)


def test_a_change_ends_every_other_session_of_the_account_and_keeps_the_one_in_use(client, session, user, admin):
    elsewhere = log_in(client).cookies[COOKIE]
    admin_token = log_in(client, email=ADMIN_EMAIL).cookies[COOKIE]
    here = log_in(client).cookies[COOKIE]
    assert len({elsewhere, admin_token, here}) == 3

    assert change(client).status_code == 204

    assert client.get("/api/auth/me").status_code == 200
    client.cookies.set(COOKIE, elsewhere)
    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")
    # Phiên của tài khoản khác không liên quan.
    client.cookies.set(COOKIE, admin_token)
    assert client.get("/api/auth/me").json()["user"]["email"] == ADMIN_EMAIL
    assert session.scalar(select(func.count()).select_from(UserSession).where(UserSession.user_id == user.id)) == 1


def test_a_wrong_current_password_changes_nothing(client, session, user):
    log_in(client)

    response = change(client, current="không phải mật khẩu này")

    assert error_of(response) == (403, "WRONG_PASSWORD")
    assert client.get("/api/auth/me").status_code == 200  # vẫn đăng nhập
    client.post("/api/auth/logout", headers=BROWSER)
    assert log_in(client).status_code == 200
    assert error_of(log_in(client, password=NEW_PASSWORD)) == (401, "INVALID_CREDENTIALS")
    assert ("password_change_failed", user.id, f"user:{user.id}") in actions(session)
    assert "password_changed" not in [action for action, _, _ in actions(session)]


def test_five_wrong_current_passwords_lock_the_account_even_for_the_right_one(client, session, user):
    log_in(client)
    for _ in range(4):
        assert error_of(change(client, current="đoán mò mật khẩu")) == (403, "WRONG_PASSWORD")
    assert error_of(change(client, current="đoán mò mật khẩu")) == (403, "WRONG_PASSWORD")

    # Lần thứ sáu dùng mật khẩu đúng vẫn bị từ chối, và mật khẩu không đổi.
    assert error_of(change(client)) == (429, "TOO_MANY_ATTEMPTS")
    session.refresh(user)
    assert user.locked_until is not None
    assert passwords.verify_password(PASSWORD, user.password_hash)
    # Cùng một khoá với đăng nhập: trong lúc khoá, đăng nhập bằng mật khẩu đúng cũng không được.
    assert error_of(log_in(client)) == (401, "INVALID_CREDENTIALS")
    assert [action for action, _, _ in actions(session)].count("login_locked") == 1


def test_wrong_passwords_at_the_login_and_at_the_change_form_are_counted_together(client, session, user):
    log_in(client)
    for _ in range(3):
        log_in(client, password="sai mật khẩu rồi")
    assert error_of(change(client, current="đoán mò mật khẩu")) == (403, "WRONG_PASSWORD")
    session.refresh(user)
    assert (user.failed_logins, user.locked_until) == (4, None)

    change(client, current="đoán mò mật khẩu")

    session.refresh(user)
    assert user.locked_until is not None


def test_a_successful_change_clears_the_count_of_wrong_passwords(client, session, user):
    log_in(client)
    for _ in range(4):
        change(client, current="đoán mò mật khẩu")

    assert change(client).status_code == 204

    session.refresh(user)
    assert (user.failed_logins, user.failed_since, user.locked_until) == (0, None, None)


def test_a_lock_that_has_passed_no_longer_stops_a_change(client, session, user):
    log_in(client)
    user.locked_until = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=1)
    session.flush()

    assert change(client).status_code == 204


@pytest.mark.parametrize(
    ("new", "code"),
    [
        ("ngắn quá", "WEAK_PASSWORD"),
        ("x" * 201, "WEAK_PASSWORD"),
        (PASSWORD, "SAME_PASSWORD"),
        # Cùng mật khẩu gõ bằng bộ gõ dấu rời: sau chuẩn hoá vẫn là mật khẩu cũ.
        (unicodedata.normalize("NFD", PASSWORD), "SAME_PASSWORD"),
    ],
)
def test_a_new_password_that_is_weak_or_not_new_is_refused_and_the_old_one_stays(client, session, user, new, code):
    log_in(client)
    before = user.password_hash

    response = change(client, new=new)

    assert error_of(response) == (422, "VALIDATION_ERROR")
    assert problems(response) == [("newPassword", code)]
    session.refresh(user)
    assert user.password_hash == before
    assert "password_changed" not in [action for action, _, _ in actions(session)]


def test_the_current_password_is_checked_before_the_new_one_is_judged(client, session, user):
    # Người không biết mật khẩu hiện tại không được dùng endpoint này để dò quy tắc, và lần thử của họ bị đếm.
    log_in(client)

    assert error_of(change(client, current="đoán mò mật khẩu", new="ngắn")) == (403, "WRONG_PASSWORD")

    session.refresh(user)
    assert user.failed_logins == 1


def test_changing_a_password_needs_a_login_the_browser_header_and_both_fields(client, user):
    assert error_of(change(client)) == (401, "NOT_AUTHENTICATED")
    log_in(client)
    assert error_of(change(client, headers=None)) == (403, "CSRF_HEADER_REQUIRED")
    missing = client.post("/api/auth/password", json={"newPassword": NEW_PASSWORD}, headers=BROWSER)
    assert error_of(missing) == (422, "VALIDATION_ERROR")
    too_long = change(client, current="x" * (passwords.RAW_LIMIT + 1))
    assert error_of(too_long) == (422, "VALIDATION_ERROR")
    assert log_in(client).status_code == 200


def test_a_change_is_turned_away_when_too_many_passwords_are_being_checked(client, session, user, monkeypatch):
    log_in(client)

    def busy(*_args):
        raise passwords.TooBusy("no free slot")

    monkeypatch.setattr(service, "verify_password", busy)

    assert error_of(change(client)) == (503, "LOGIN_BUSY")
    session.refresh(user)
    assert (user.failed_logins, user.locked_until) == (0, None)


def test_a_change_writes_no_password_anywhere(client, session, user):
    log_in(client)
    wrong = change(client, current="đoán mò mật khẩu")
    done = change(client)

    written = audit_text(session) + wrong.text + done.text
    for secret in (PASSWORD, NEW_PASSWORD, "đoán mò mật khẩu", "scrypt$"):
        assert secret not in written


def test_a_change_is_saved_from_one_request_to_the_next(engine):
    from app.main import app

    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions.begin() as setup:
        service.create_user(setup, email=EMAIL, display_name="Phòng xét nghiệm A", password=PASSWORD)
    try:
        with TestClient(app) as first:
            log_in(first)
            assert change(first).status_code == 204
        with TestClient(app) as second:
            assert error_of(log_in(second)) == (401, "INVALID_CREDENTIALS")
            assert log_in(second, password=NEW_PASSWORD).status_code == 200
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE app_user, audit_log CASCADE"))


# --- Admin quản lý tài khoản ---

ADMIN_ENDPOINTS = [
    ("GET", "/api/admin/users", None),
    ("POST", "/api/admin/users", {"email": "a@b.vn", "displayName": "A", "role": "submitter", "password": PASSWORD}),
    ("POST", "/api/admin/users/1/lock", None),
    ("POST", "/api/admin/users/1/unlock", None),
    ("POST", "/api/admin/users/1/password", {"password": NEW_PASSWORD}),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ENDPOINTS)
def test_managing_accounts_is_for_administrators_only(client, session, user, admin, method, path, body):
    before = session.scalar(select(func.count()).select_from(AppUser))

    assert error_of(client.request(method, path, json=body, headers=BROWSER)) == (401, "NOT_AUTHENTICATED")
    log_in(client)
    assert error_of(client.request(method, path, json=body, headers=BROWSER)) == (403, "FORBIDDEN")
    if method != "GET":
        log_in(client, email=ADMIN_EMAIL)
        assert error_of(client.request(method, path, json=body)) == (403, "CSRF_HEADER_REQUIRED")

    assert session.scalar(select(func.count()).select_from(AppUser)) == before
    session.refresh(user)
    assert (user.is_locked, passwords.verify_password(PASSWORD, user.password_hash)) == (False, True)


def test_the_list_of_accounts_says_who_is_locked_and_carries_no_secret(client, session, user, admin):
    user.is_locked = True
    session.flush()
    log_in(client, email=ADMIN_EMAIL)

    response = client.get("/api/admin/users")

    items = response.json()["items"]
    assert [(item["id"], item["email"], item["displayName"], item["role"], item["isLocked"]) for item in items] == [
        (admin.id, ADMIN_EMAIL, "Quản trị", "admin", False),
        (user.id, EMAIL, "Phòng xét nghiệm A", "submitter", True),
    ]
    assert all(set(item) == {"id", "email", "displayName", "role", "isLocked", "createdAt"} for item in items)
    assert "scrypt$" not in response.text
    assert response.headers["cache-control"] == "no-store"


def create(client, **changes):
    body = {"email": "Moi@Example.org ", "displayName": " Viện Pasteur ", "role": "submitter", "password": NEW_PASSWORD}
    return client.post("/api/admin/users", json=body | changes, headers=BROWSER)


def test_an_administrator_creates_an_account_that_can_log_in(client, session, admin):
    log_in(client, email=ADMIN_EMAIL)

    response = create(client)

    assert response.status_code == 201
    created = response.json()
    assert (created["email"], created["displayName"], created["role"], created["isLocked"]) == (
        "moi@example.org",
        "Viện Pasteur",
        "submitter",
        False,
    )
    assert NEW_PASSWORD not in response.text and "scrypt$" not in response.text
    assert actions(session)[-1] == ("user_created", admin.id, f"user:{created['id']}")
    assert NEW_PASSWORD not in audit_text(session)
    assert log_in(client, email="moi@example.org", password=NEW_PASSWORD).json()["user"]["role"] == "submitter"


def test_an_administrator_can_create_another_administrator(client, admin):
    log_in(client, email=ADMIN_EMAIL)

    assert create(client, role="admin").json()["role"] == "admin"


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"email": "không phải email"}, [("email", "INVALID_EMAIL")]),
        ({"email": "a@b.vn\x00"}, [("email", "INVALID_EMAIL")]),
        ({"displayName": "   "}, [("displayName", "INVALID_NAME")]),
        ({"displayName": "x" * 101}, [("displayName", "INVALID_NAME")]),
        ({"displayName": "hai\ndòng"}, [("displayName", "INVALID_NAME")]),
        ({"role": "owner"}, [("role", "UNKNOWN_ROLE")]),
        ({"password": "ngắn quá"}, [("password", "WEAK_PASSWORD")]),
        (
            {"email": "x", "displayName": "", "role": "", "password": ""},
            [
                ("email", "INVALID_EMAIL"),
                ("displayName", "INVALID_NAME"),
                ("role", "UNKNOWN_ROLE"),
                ("password", "WEAK_PASSWORD"),
            ],
        ),
    ],
)
def test_an_account_that_cannot_be_right_is_refused_with_every_reason(client, session, admin, changes, expected):
    log_in(client, email=ADMIN_EMAIL)

    response = create(client, **changes)

    assert error_of(response) == (422, "VALIDATION_ERROR")
    assert problems(response) == expected
    assert session.scalar(select(func.count()).select_from(AppUser)) == 1


def test_an_email_that_already_has_an_account_is_refused(client, session, user, admin):
    log_in(client, email=ADMIN_EMAIL)

    response = create(client, email=f"  {EMAIL.upper()}")

    assert error_of(response) == (409, "EMAIL_TAKEN")
    assert session.scalar(select(func.count()).select_from(AppUser)) == 2


def test_locking_an_account_ends_its_sessions_at_once_and_unlocking_lets_it_back_in(client, session, user, admin):
    theirs = log_in(client).cookies[COOKIE]
    log_in(client, email=ADMIN_EMAIL)
    mine = client.cookies[COOKIE]

    locked = client.post(f"/api/admin/users/{user.id}/lock", headers=BROWSER)

    assert (locked.status_code, locked.content) == (204, b"")
    assert session.scalar(select(func.count()).select_from(UserSession).where(UserSession.user_id == user.id)) == 0
    client.cookies.set(COOKIE, theirs)
    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")
    assert error_of(log_in(client)) == (401, "INVALID_CREDENTIALS")

    client.cookies.set(COOKIE, mine)
    assert client.post(f"/api/admin/users/{user.id}/unlock", headers=BROWSER).status_code == 204
    assert log_in(client).status_code == 200
    assert [row for row in actions(session) if row[0] in ("user_locked", "user_unlocked")] == [
        ("user_locked", admin.id, f"user:{user.id}"),
        ("user_unlocked", admin.id, f"user:{user.id}"),
    ]


def test_locking_twice_or_unlocking_what_is_not_locked_is_not_recorded_again(client, session, user, admin):
    log_in(client, email=ADMIN_EMAIL)

    for step in ("unlock", "lock", "lock"):
        assert client.post(f"/api/admin/users/{user.id}/{step}", headers=BROWSER).status_code == 204

    assert [action for action, _, _ in actions(session) if action.startswith("user_")].count("user_locked") == 1
    assert "user_unlocked" not in [action for action, _, _ in actions(session)]


def test_unlocking_also_lifts_a_lock_earned_by_wrong_passwords(client, session, user, admin):
    for _ in range(5):
        log_in(client, password="sai mật khẩu rồi")
    assert error_of(log_in(client)) == (401, "INVALID_CREDENTIALS")
    log_in(client, email=ADMIN_EMAIL)

    assert client.post(f"/api/admin/users/{user.id}/unlock", headers=BROWSER).status_code == 204

    session.refresh(user)
    assert (user.is_locked, user.locked_until, user.failed_logins) == (False, None, 0)
    assert log_in(client).status_code == 200
    assert ("user_unlocked", admin.id, f"user:{user.id}") in actions(session)


def test_an_administrator_cannot_lock_the_account_being_used(client, session, admin):
    log_in(client, email=ADMIN_EMAIL)

    response = client.post(f"/api/admin/users/{admin.id}/lock", headers=BROWSER)

    assert error_of(response) == (409, "CANNOT_LOCK_SELF")
    session.refresh(admin)
    assert admin.is_locked is False
    assert client.get("/api/auth/me").status_code == 200


def test_an_administrator_sets_a_new_password_for_someone_else(client, session, user, admin):
    theirs = log_in(client).cookies[COOKIE]
    for _ in range(5):
        log_in(client, password="sai mật khẩu rồi")
    log_in(client, email=ADMIN_EMAIL)
    mine = client.cookies[COOKIE]

    response = client.post(f"/api/admin/users/{user.id}/password", json={"password": NEW_PASSWORD}, headers=BROWSER)

    assert (response.status_code, response.content) == (204, b"")
    # Mọi phiên của người đó kết thúc; việc khoá tạm vì nhập sai cũng được gỡ, để mật khẩu mới dùng được ngay.
    client.cookies.set(COOKIE, theirs)
    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")
    assert error_of(log_in(client)) == (401, "INVALID_CREDENTIALS")
    assert log_in(client, password=NEW_PASSWORD).status_code == 200
    client.cookies.set(COOKIE, mine)
    assert client.get("/api/auth/me").json()["user"]["email"] == ADMIN_EMAIL
    assert ("password_reset", admin.id, f"user:{user.id}") in actions(session)
    assert NEW_PASSWORD not in audit_text(session)


def test_a_weak_password_set_by_an_administrator_is_refused(client, session, user, admin):
    log_in(client, email=ADMIN_EMAIL)

    response = client.post(f"/api/admin/users/{user.id}/password", json={"password": "ngắn quá"}, headers=BROWSER)

    assert error_of(response) == (422, "VALIDATION_ERROR")
    assert problems(response) == [("password", "WEAK_PASSWORD")]
    session.refresh(user)
    assert passwords.verify_password(PASSWORD, user.password_hash)


def test_an_administrator_changes_the_own_password_only_through_the_form_that_asks_for_the_current_one(
    client, session, admin
):
    log_in(client, email=ADMIN_EMAIL)

    response = client.post(f"/api/admin/users/{admin.id}/password", json={"password": NEW_PASSWORD}, headers=BROWSER)

    assert error_of(response) == (409, "USE_OWN_PASSWORD_FORM")
    session.refresh(admin)
    assert passwords.verify_password(PASSWORD, admin.password_hash)
    assert client.get("/api/auth/me").status_code == 200


@pytest.mark.parametrize("identifier", ["999999", "0", "-1", "abc", "1e3", str(2**63)])
@pytest.mark.parametrize("step", ["lock", "unlock", "password"])
def test_an_account_that_does_not_exist_is_not_found(client, admin, identifier, step):
    log_in(client, email=ADMIN_EMAIL)
    body = {"password": NEW_PASSWORD} if step == "password" else None

    response = client.post(f"/api/admin/users/{identifier}/{step}", json=body, headers=BROWSER)

    assert response.status_code in (404, 422)
    assert response.json()["error"]["code"] in ("USER_NOT_FOUND", "VALIDATION_ERROR")
    if identifier == "999999":
        assert error_of(response) == (404, "USER_NOT_FOUND")


def test_wrong_current_passwords_are_remembered_from_one_request_to_the_next(engine):
    # Fixture `client` dùng chung một session nên không thấy được việc quên commit lần nhập sai.
    from app.main import app

    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions.begin() as setup:
        service.create_user(setup, email=EMAIL, display_name="Phòng xét nghiệm A", password=PASSWORD)
    try:
        with TestClient(app) as client:
            log_in(client)
            for _ in range(5):
                assert error_of(change(client, current="đoán mò mật khẩu")) == (403, "WRONG_PASSWORD")
            assert error_of(change(client)) == (429, "TOO_MANY_ATTEMPTS")
        with sessions() as check:
            stored = check.scalars(select(AppUser)).one()
            assert stored.locked_until is not None
            assert passwords.verify_password(PASSWORD, stored.password_hash)
            refused = check.scalar(
                select(func.count()).select_from(AuditLog).where(AuditLog.action == "password_change_refused")
            )
            assert refused == 1
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE app_user, audit_log CASCADE"))


def test_a_failure_nobody_foresaw_while_changing_a_password_leaves_the_old_one_in_place(engine, monkeypatch):
    from app.main import app

    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions.begin() as setup:
        service.create_user(setup, email=EMAIL, display_name="Phòng xét nghiệm A", password=PASSWORD)

    def broken(*_args, **_kwargs):
        raise RuntimeError("the audit log is unreachable")

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            log_in(client)
            # Hỏng sau khi chuỗi băm mới đã được gán: không được lưu nửa chừng (mật khẩu đổi mà phiên khác còn sống).
            monkeypatch.setattr(service, "record", broken)
            assert change(client).status_code == 500
            monkeypatch.undo()
            monkeypatch.setattr(passwords, "N", 2**10)
            assert log_in(client).status_code == 200
            assert error_of(log_in(client, password=NEW_PASSWORD)) == (401, "INVALID_CREDENTIALS")
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE app_user, audit_log CASCADE"))


def test_what_an_administrator_does_to_accounts_is_saved_from_one_request_to_the_next(engine):
    # Fixture `client` dùng chung một session nên không thấy được việc quên commit; ở đây mỗi request một session.
    from app.main import app

    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions.begin() as setup:
        service.create_user(setup, email=ADMIN_EMAIL, display_name="Quản trị", password=PASSWORD, role="admin")
    try:
        with TestClient(app) as boss, TestClient(app) as lab:
            log_in(boss, email=ADMIN_EMAIL)
            created = create(boss, email=EMAIL)
            assert created.status_code == 201
            account = created.json()["id"]
            assert log_in(lab, password=NEW_PASSWORD).status_code == 200

            assert boss.post(f"/api/admin/users/{account}/lock", headers=BROWSER).status_code == 204
            assert error_of(lab.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")
            assert error_of(log_in(lab, password=NEW_PASSWORD)) == (401, "INVALID_CREDENTIALS")

            assert boss.post(f"/api/admin/users/{account}/unlock", headers=BROWSER).status_code == 204
            assert log_in(lab, password=NEW_PASSWORD).status_code == 200

            reset = boss.post(f"/api/admin/users/{account}/password", json={"password": PASSWORD}, headers=BROWSER)
            assert reset.status_code == 204
            assert error_of(lab.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")
            assert log_in(lab).status_code == 200
        with sessions() as check:
            written = [row.action for row in check.scalars(select(AuditLog).order_by(AuditLog.id))]
            for action in ("user_locked", "user_unlocked", "password_reset"):
                assert written.count(action) == 1
            assert written.count("user_created") == 2
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE app_user, audit_log CASCADE"))
