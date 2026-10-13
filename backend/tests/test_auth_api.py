import datetime as dt
import hashlib
import io
import threading
import time
import types

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from app.accounts import passwords, service
from app.models import AppUser, AuditLog, UserSession

EMAIL = "lab@example.org"
PASSWORD = "mật khẩu đủ dài"
COOKIE = "vs_session"
# Header mà frontend tự gắn vào mọi request ghi; trang khác không gắn được nó khi gửi kèm cookie.
BROWSER = {"X-Requested-With": "vietstrain"}


@pytest.fixture(autouse=True)
def cheap_hashing(monkeypatch):
    """Băm nhẹ cho test: tham số nằm trong chuỗi băm nên việc kiểm tra vẫn đi đúng đường thật."""
    monkeypatch.setattr(passwords, "N", 2**10)
    # Chuỗi băm dùng cho email lạ được tính một lần rồi giữ lại; tính lại với tham số nhẹ của test này.
    service.unknown_email_hash.cache_clear()
    yield
    service.unknown_email_hash.cache_clear()


@pytest.fixture
def user(session) -> AppUser:
    return service.create_user(session, email=EMAIL, display_name="Phòng xét nghiệm A", password=PASSWORD)


@pytest.fixture
def admin(session) -> AppUser:
    return service.create_user(
        session, email="admin@example.org", display_name="Quản trị", password=PASSWORD, role="admin"
    )


@pytest.fixture
def real(engine):
    """Ứng dụng với session thật của nó: mỗi request một session và một lần commit, như khi chạy thật.

    Fixture `client` cho mọi request dùng chung một session, nên không thấy được việc quên commit.
    """
    from app.main import app

    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions.begin() as setup:
        service.create_user(setup, email=EMAIL, display_name="Phòng xét nghiệm A", password=PASSWORD)
    with TestClient(app) as client:
        yield client, sessions
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE app_user, audit_log CASCADE"))


def log_in(client, email: str = EMAIL, password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password}, headers=BROWSER)


def error_of(response) -> tuple[int, str]:
    return response.status_code, response.json()["error"]["code"]


def test_logging_in_sets_a_session_cookie_and_returns_the_user(client, user):
    response = log_in(client)

    assert response.status_code == 200
    assert response.json() == {"user": {"email": EMAIL, "displayName": "Phòng xét nghiệm A", "role": "submitter"}}
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}=")
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/" in cookie
    # Máy phát triển chạy HTTP; cờ Secure bật bằng cấu hình khi đứng sau HTTPS.
    assert "Secure" not in cookie
    assert client.get("/api/auth/me").json() == response.json()


def test_the_session_cookie_is_marked_secure_when_configured(client, user, monkeypatch):
    monkeypatch.setattr("app.config.settings.cookie_secure", True)

    assert "Secure" in log_in(client).headers["set-cookie"]
    assert "Secure" in client.post("/api/auth/logout", headers=BROWSER).headers["set-cookie"]


def test_nobody_is_logged_in_without_a_cookie(client):
    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")


def test_a_wrong_password_and_an_unknown_email_get_the_same_answer(client, user):
    wrong = log_in(client, password="sai mật khẩu rồi")
    unknown = log_in(client, email="nobody@example.org")

    assert error_of(wrong) == (401, "INVALID_CREDENTIALS")
    assert unknown.status_code == wrong.status_code and unknown.json() == wrong.json()
    assert "set-cookie" not in wrong.headers and "set-cookie" not in unknown.headers
    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")


def test_the_email_is_matched_without_regard_to_case_or_surrounding_spaces(client, user):
    assert log_in(client, email="  LAB@Example.ORG ").status_code == 200


def test_logging_out_ends_the_session_on_the_server(client, user):
    token = log_in(client).cookies[COOKIE]

    response = client.post("/api/auth/logout", headers=BROWSER)

    assert response.status_code == 204
    # Trình duyệt được bảo xoá cookie.
    cleared = response.headers["set-cookie"]
    assert cleared.startswith(f'{COOKIE}="";') and "Max-Age=0" in cleared
    # Lệnh xoá mang cùng thuộc tính với lúc đặt, để trình duyệt nào cũng coi là cùng một cookie.
    assert "HttpOnly" in cleared and "SameSite=lax" in cleared and "Path=/" in cleared
    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")
    # Cookie cũ bị ai đó giữ lại cũng không còn dùng được.
    client.cookies.set(COOKIE, token)
    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")


def test_logging_out_without_a_session_is_not_an_error(client):
    assert client.post("/api/auth/logout", headers=BROWSER).status_code == 204


def test_the_database_keeps_only_a_hash_of_the_session_token(client, session, user):
    token = log_in(client).cookies[COOKIE]

    stored = session.scalars(select(UserSession.token_hash)).all()

    assert stored == [hashlib.sha256(token.encode()).hexdigest()]
    assert len(token) >= 43  # 256 bit ngẫu nhiên, viết bằng base64


def test_each_login_gets_a_new_token(client, user):
    first = log_in(client).cookies[COOKIE]
    second = log_in(client).cookies[COOKIE]

    assert first != second


def test_five_wrong_passwords_lock_the_account_even_for_the_right_one(client, session, user):
    for _ in range(5):
        assert error_of(log_in(client, password="sai mật khẩu rồi")) == (401, "INVALID_CREDENTIALS")

    assert error_of(log_in(client)) == (401, "INVALID_CREDENTIALS")

    # Hết 15 phút thì đăng nhập lại được.
    user.locked_until -= dt.timedelta(minutes=16)
    session.flush()
    assert log_in(client).status_code == 200


def test_four_wrong_passwords_do_not_lock_and_a_good_login_clears_the_count(client, user):
    for _ in range(4):
        log_in(client, password="sai mật khẩu rồi")
    assert log_in(client).status_code == 200

    for _ in range(4):
        log_in(client, password="sai mật khẩu rồi")
    assert log_in(client).status_code == 200


def test_wrong_passwords_more_than_fifteen_minutes_apart_do_not_add_up(client, session, user):
    for _ in range(4):
        log_in(client, password="sai mật khẩu rồi")
    user.failed_since -= dt.timedelta(minutes=16)
    session.flush()

    log_in(client, password="sai mật khẩu rồi")

    assert log_in(client).status_code == 200


def test_an_account_locked_by_an_admin_cannot_log_in_and_loses_its_sessions(client, session, user):
    assert log_in(client).status_code == 200
    user.is_locked = True
    session.flush()

    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")
    assert error_of(log_in(client)) == (401, "INVALID_CREDENTIALS")


def test_a_session_ends_after_seven_days_without_use(client, session, user):
    log_in(client)
    stored = session.scalars(select(UserSession)).one()

    stored.last_seen_at -= dt.timedelta(days=6, hours=23)
    session.flush()
    assert client.get("/api/auth/me").status_code == 200

    stored.last_seen_at = dt.datetime.now(dt.UTC) - dt.timedelta(days=7, minutes=1)
    session.flush()
    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")


def test_using_a_session_keeps_it_alive(client, session, user):
    log_in(client)
    stored = session.scalars(select(UserSession)).one()
    stored.last_seen_at -= dt.timedelta(days=3)
    session.flush()

    client.get("/api/auth/me")

    session.refresh(stored)
    assert dt.datetime.now(dt.UTC) - stored.last_seen_at < dt.timedelta(minutes=1)


def test_a_session_ends_thirty_days_after_login_however_much_it_is_used(client, session, user):
    log_in(client)
    stored = session.scalars(select(UserSession)).one()
    stored.created_at -= dt.timedelta(days=30, minutes=1)
    session.flush()

    assert error_of(client.get("/api/auth/me")) == (401, "NOT_AUTHENTICATED")


def test_a_write_request_without_the_browser_header_is_refused(client, user):
    response = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})

    assert error_of(response) == (403, "CSRF_HEADER_REQUIRED")
    assert "set-cookie" not in response.headers
    # Request đọc không cần header này.
    assert client.get("/api/health").status_code == 200


def test_an_admin_endpoint_wants_a_login_and_the_admin_role(client, user, admin):
    assert error_of(client.get("/api/admin/users")) == (401, "NOT_AUTHENTICATED")

    log_in(client)
    assert error_of(client.get("/api/admin/users")) == (403, "FORBIDDEN")

    log_in(client, email="admin@example.org")
    response = client.get("/api/admin/users")
    assert response.status_code == 200
    assert [item["email"] for item in response.json()["items"]] == ["admin@example.org", EMAIL]


def test_no_response_carries_a_password_hash_or_a_session_token(client, session, user, admin):
    login = log_in(client, email="admin@example.org")
    token = login.cookies[COOKIE]
    bodies = [login.text, client.get("/api/auth/me").text, client.get("/api/admin/users").text]

    for body in bodies:
        assert token not in body
        assert "scrypt$" not in body and "passwordHash" not in body and "password_hash" not in body


def test_logins_and_logouts_are_written_to_the_audit_log_without_secrets(client, session, user):
    log_in(client, password="sai mật khẩu rồi")
    token = log_in(client).cookies[COOKIE]
    client.post("/api/auth/logout", headers=BROWSER)

    rows = session.execute(select(AuditLog.action, AuditLog.actor_id, AuditLog.detail).order_by(AuditLog.id)).all()

    assert [(action, actor) for action, actor, _ in rows] == [
        ("user_created", None),  # tài khoản của fixture, tạo từ dòng lệnh nên không có người làm
        ("login_failed", user.id),
        ("login", user.id),
        ("logout", user.id),
    ]
    written = repr(rows)
    assert PASSWORD not in written and "sai mật khẩu rồi" not in written and token not in written


def test_the_fifth_wrong_password_is_recorded_as_a_lock(client, session, user):
    for _ in range(5):
        log_in(client, password="sai mật khẩu rồi")

    actions = session.scalars(select(AuditLog.action).where(AuditLog.actor_id == user.id).order_by(AuditLog.id)).all()

    assert actions == ["login_failed"] * 4 + ["login_locked"]


def test_a_login_request_must_have_an_email_and_a_password(client):
    response = client.post("/api/auth/login", json={"email": EMAIL}, headers=BROWSER)

    assert error_of(response) == (422, "VALIDATION_ERROR")


def test_an_absurdly_long_password_is_refused_without_work(client, user):
    response = log_in(client, password="x" * 5000)

    assert error_of(response) == (422, "VALIDATION_ERROR")
    # Lỗi kiểm tra đầu vào không chép lại mật khẩu vừa gửi.
    assert "xxxxx" not in response.text


def test_creating_a_user_refuses_a_taken_email_a_weak_password_and_an_unknown_role(session, user):
    with pytest.raises(service.EmailTaken):
        service.create_user(session, email=" LAB@example.org", display_name="Trùng", password=PASSWORD)
    with pytest.raises(passwords.WeakPassword):
        service.create_user(session, email="b@example.org", display_name="B", password="ngắn")
    with pytest.raises(ValueError, match="role"):
        service.create_user(session, email="c@example.org", display_name="C", password=PASSWORD, role="root")
    with pytest.raises(ValueError, match="email"):
        service.create_user(session, email="not-an-email", display_name="D", password=PASSWORD)


def test_a_new_user_is_stored_with_a_lowercase_email_and_a_hashed_password(session):
    created = service.create_user(session, email="  New@Example.ORG ", display_name=" Người mới ", password=PASSWORD)

    assert (created.email, created.display_name, created.role) == ("new@example.org", "Người mới", "submitter")
    assert created.password_hash.startswith("scrypt$") and PASSWORD not in created.password_hash
    assert session.scalars(select(AuditLog.action)).all() == ["user_created"]


def test_an_unknown_email_costs_one_password_check_like_a_known_one(client, user, monkeypatch):
    # Thời gian trả lời không được cho biết email nào có tài khoản: cả hai trường hợp đều băm đúng một lần.
    calls = []
    real_verify = service.verify_password
    monkeypatch.setattr(service, "verify_password", lambda *args: calls.append(1) or real_verify(*args))

    log_in(client, email="nobody@example.org")
    assert len(calls) == 1

    log_in(client, password="sai mật khẩu rồi")
    assert len(calls) == 2


def test_wrong_passwords_are_remembered_from_one_request_to_the_next(real):
    client, _sessions = real
    for _ in range(5):
        assert error_of(log_in(client, password="sai mật khẩu rồi")) == (401, "INVALID_CREDENTIALS")

    assert error_of(log_in(client)) == (401, "INVALID_CREDENTIALS")


def test_a_session_lasts_from_one_request_to_the_next_and_logging_out_removes_it(real):
    client, sessions = real
    assert log_in(client).status_code == 200
    assert client.get("/api/auth/me").status_code == 200

    assert client.post("/api/auth/logout", headers=BROWSER).status_code == 204

    with sessions() as check:
        assert check.scalars(select(UserSession)).all() == []
        assert check.scalars(select(AuditLog.action).order_by(AuditLog.id)).all() == ["user_created", "login", "logout"]


def test_the_use_of_a_session_is_saved(real):
    client, sessions = real
    log_in(client)
    with sessions.begin() as change:
        change.scalars(select(UserSession)).one().last_seen_at -= dt.timedelta(days=3)

    client.get("/api/auth/me")

    with sessions() as check:
        last_seen = check.scalars(select(UserSession.last_seen_at)).one()
    assert dt.datetime.now(dt.UTC) - last_seen < dt.timedelta(minutes=1)


@pytest.mark.parametrize("email", ["a\x00b@example.org", "tab\there@example.org", "not-an-email", "@", ""])
def test_an_email_that_could_never_be_an_account_is_answered_like_an_unknown_one(client, user, email):
    unknown = log_in(client, email="nobody@example.org")

    response = log_in(client, email=email)

    assert (response.status_code, response.json()) == (unknown.status_code, unknown.json())


def test_text_that_is_not_valid_unicode_is_refused_as_a_bad_request_not_a_crash(client, user):
    # Nửa cặp surrogate lẻ: JSON viết được nó, UTF-8 thì không. Lớp kiểm tra đầu vào từ chối nó trước khi nó
    # tới câu truy vấn hay bước băm, và từ chối như nhau dù email có tài khoản hay không.
    bodies = [
        b'{"email": "lab@example.org", "password": "\\ud800aaaaaaaaaaaa"}',
        b'{"email": "\\ud800@example.org", "password": "aaaaaaaaaaaa"}',
        b'{"email": "nobody@example.org", "password": "\\ud800aaaaaaaaaaaa"}',
    ]

    for body in bodies:
        response = client.post("/api/auth/login", content=body, headers=BROWSER | {"Content-Type": "application/json"})
        assert error_of(response) == (422, "VALIDATION_ERROR")
        # Thông báo lỗi không chép lại thứ vừa gửi lên.
        assert "aaaaaaaaaaaa" not in response.text


def test_every_failed_login_leaves_one_audit_row_and_never_the_text_that_was_typed(client, session, user):
    log_in(client, email="nobody@example.org", password="mật khẩu gõ nhầm vào đây")
    log_in(client, email="mật khẩu gõ nhầm vào ô email", password="x" * 12)
    for _ in range(5):
        log_in(client, password="sai mật khẩu rồi")
    log_in(client)  # đang bị khoá

    rows = session.execute(
        select(AuditLog.action, AuditLog.actor_id, AuditLog.subject, AuditLog.detail).order_by(AuditLog.id)
    ).all()

    assert [(action, actor) for action, actor, _, _ in rows] == [
        ("user_created", None),
        ("login_failed", None),
        ("login_failed", None),
        *[("login_failed", user.id)] * 4,
        ("login_locked", user.id),
        ("login_refused", user.id),
    ]
    assert "gõ nhầm" not in repr(rows) and "nobody" not in repr(rows) and PASSWORD not in repr(rows)


def test_attempts_made_while_locked_do_not_extend_the_lock(client, session, user):
    for _ in range(5):
        log_in(client, password="sai mật khẩu rồi")
    until = user.locked_until

    for _ in range(3):
        log_in(client, password="sai mật khẩu rồi")

    session.refresh(user)
    assert user.locked_until == until


def test_after_a_lock_has_passed_one_wrong_password_does_not_lock_again(client, session, user):
    for _ in range(5):
        log_in(client, password="sai mật khẩu rồi")
    user.locked_until -= dt.timedelta(minutes=16)
    session.flush()

    log_in(client, password="sai mật khẩu rồi")

    assert log_in(client).status_code == 200


def test_an_admin_locked_account_is_refused_like_any_other_failure(client, session, user):
    wrong = log_in(client, password="sai mật khẩu rồi")
    user.is_locked = True
    session.flush()

    response = log_in(client)

    assert (response.status_code, response.json()) == (wrong.status_code, wrong.json())
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize("path", ["/api/auth/login", "/api/auth/logout", "/api/samples", "/api/no-such-thing", "/"])
def test_every_write_request_needs_the_browser_header_whatever_it_targets(client, method, path):
    refused = client.request(method, path)
    allowed = client.request(method, path, headers=BROWSER)

    assert error_of(refused) == (403, "CSRF_HEADER_REQUIRED")
    # Có header thì request đi tiếp tới chỗ xử lý bình thường của nó.
    assert allowed.status_code != 403


def test_requests_refused_for_the_missing_header_do_not_count_as_wrong_passwords(client, user):
    for _ in range(6):
        response = client.post("/api/auth/login", json={"email": EMAIL, "password": "sai mật khẩu rồi"})
        assert response.status_code == 403

    assert log_in(client).status_code == 200


def test_answers_about_accounts_are_never_to_be_stored(client, user, admin):
    log_in(client, email="admin@example.org")
    responses = [
        log_in(client, password="sai mật khẩu rồi"),
        log_in(client, email="admin@example.org"),
        client.get("/api/auth/me"),
        client.get("/api/admin/users"),
        client.post("/api/auth/logout", headers=BROWSER),
        client.get("/api/auth/me"),
        client.post("/api/auth/login", json={}),
    ]

    assert [response.headers.get("cache-control") for response in responses] == ["no-store"] * len(responses)
    # Dữ liệu công khai không bị ảnh hưởng.
    assert client.get("/api/health").headers.get("cache-control") is None


def test_a_login_is_turned_away_when_too_many_are_being_checked(client, session, user, monkeypatch):
    def busy(*_args):
        raise passwords.TooBusy("no free slot")

    monkeypatch.setattr(service, "verify_password", busy)

    response = log_in(client)

    assert error_of(response) == (503, "LOGIN_BUSY")
    assert "set-cookie" not in response.headers
    # Lần bị từ chối vì quá tải không phải một lần sai mật khẩu.
    session.refresh(user)
    assert (user.failed_logins, user.locked_until) == (0, None)


def test_an_unexpected_failure_is_reported_without_its_details(session, user, monkeypatch, caplog):
    from app.db import get_session
    from app.main import app

    def explode(*_args, **_kwargs):
        raise RuntimeError("secret detail from inside the server")

    monkeypatch.setattr(service, "log_in", explode)
    app.dependency_overrides[get_session] = lambda: session
    try:
        with TestClient(app, raise_server_exceptions=False) as quiet:
            response = log_in(quiet)
    finally:
        app.dependency_overrides.clear()

    assert error_of(response) == (500, "INTERNAL_ERROR")
    assert "secret detail" not in response.text and "Traceback" not in response.text
    # Câu trả lời lỗi ở đường dẫn của tài khoản cũng không được giữ lại.
    assert response.headers.get("cache-control") == "no-store"
    # Chi tiết không mất: nó nằm trong log của server, nơi người vận hành đọc được.
    assert "POST /api/auth/login" in caplog.text and "secret detail from inside the server" in caplog.text


def test_logging_in_works_with_the_real_cost_of_hashing(client, session, monkeypatch):
    # Các test khác băm nhẹ cho nhanh; test này đi trọn đường với tham số thật.
    monkeypatch.setattr(passwords, "N", 2**17)
    service.create_user(session, email="real@example.org", display_name="Thật", password=PASSWORD)

    assert log_in(client, email="real@example.org").status_code == 200
    assert error_of(log_in(client, email="real@example.org", password="sai mật khẩu rồi")) == (
        401,
        "INVALID_CREDENTIALS",
    )


def test_a_display_name_must_be_readable_text(session):
    with pytest.raises(ValueError, match="name"):
        service.create_user(session, email="e@example.org", display_name="tên\x00lạ", password=PASSWORD)


def _wait_for(condition, seconds: float = 5.0) -> bool:
    deadline = time.monotonic() + seconds
    while not condition():
        if time.monotonic() > deadline:
            return False
        time.sleep(0.01)
    return True


def test_logins_beyond_the_limit_are_turned_away_at_once_even_when_they_all_name_one_account(real, engine, monkeypatch):
    # Các lần đăng nhập vào cùng một email xếp hàng sau khoá của dòng tài khoản. Chỗ chờ đó phải nằm trong trần
    # chung: lần vượt trần bị từ chối ngay, và lần đang chờ tới lượt chưa giữ kết nối database nào.
    client, _sessions = real
    release = threading.Event()
    real_scrypt = passwords.hashlib.scrypt

    def held_scrypt(*args, **kwargs):
        release.wait(10)
        return real_scrypt(*args, **kwargs)

    monkeypatch.setattr(passwords.hashlib, "scrypt", held_scrypt)
    capacity = passwords.CONCURRENT_HASHES + passwords.WAITING_HASHES
    extra = 6
    statuses: list[int] = []

    def attempt():
        statuses.append(log_in(client, password="sai mật khẩu rồi").status_code)

    threads = [threading.Thread(target=attempt) for _ in range(capacity + extra)]
    for thread in threads:
        thread.start()
    try:
        answered_at_once = _wait_for(lambda: len(statuses) >= extra)
        early = list(statuses)
        connections = engine.pool.checkedout()
    finally:
        release.set()
        for thread in threads:
            thread.join()

    assert answered_at_once and early == [503] * extra
    assert connections <= passwords.CONCURRENT_HASHES
    assert sorted(statuses) == [401] * capacity + [503] * extra


def test_wrong_passwords_tried_at_the_same_moment_are_all_counted(real, monkeypatch):
    # Không có khoá dòng thì các lần thử song song cùng đọc bộ đếm cũ rồi ghi đè nhau: gửi cả loạt một lúc là
    # vượt được giới hạn năm lần.
    client, sessions = real
    real_scrypt = passwords.hashlib.scrypt

    def slow_scrypt(*args, **kwargs):
        time.sleep(0.05)
        return real_scrypt(*args, **kwargs)

    monkeypatch.setattr(passwords.hashlib, "scrypt", slow_scrypt)
    threads = [
        threading.Thread(target=log_in, args=(client,), kwargs={"password": "sai mật khẩu rồi"}) for _ in range(8)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    with sessions() as check:
        actions = check.scalars(select(AuditLog.action).where(AuditLog.action != "user_created")).all()
    assert sorted(actions) == ["login_failed"] * 4 + ["login_locked"] + ["login_refused"] * 3
    assert error_of(log_in(client)) == (401, "INVALID_CREDENTIALS")


def test_the_first_login_after_a_start_costs_one_hash_even_for_an_unknown_email(session, monkeypatch):
    # Email lạ được so với một chuỗi băm giả. Chuỗi đó phải có sẵn từ lúc server khởi động: nếu lần đăng nhập
    # đầu tiên phải tự tạo nó thì lần đó chậm gấp đôi, và độ chậm ấy nói rằng email không có tài khoản.
    from app.db import get_session
    from app.main import app

    calls = []
    real_scrypt = passwords.hashlib.scrypt
    app.dependency_overrides[get_session] = lambda: session
    try:
        with TestClient(app) as started:
            monkeypatch.setattr(
                passwords.hashlib, "scrypt", lambda *args, **kwargs: calls.append(1) or real_scrypt(*args, **kwargs)
            )
            log_in(started, email="nobody@example.org")
    finally:
        app.dependency_overrides.clear()

    assert len(calls) == 1


def _create_user_from_stdin(monkeypatch, typed: bytes, email: str = "cli@example.org") -> None:
    from app import cli

    monkeypatch.setattr(cli.sys, "stdin", types.SimpleNamespace(buffer=io.BytesIO(typed)))
    cli.main(["create-user", "--email", email, "--name", "Người dùng lệnh", "--role", "submitter", "--password-stdin"])


def test_the_admin_command_reads_a_vietnamese_password_from_standard_input(real, monkeypatch, capsys):
    client, _sessions = real

    _create_user_from_stdin(monkeypatch, "mật khẩu từ dòng lệnh\r\n".encode())

    assert "cli@example.org" in capsys.readouterr().out
    assert log_in(client, email="cli@example.org", password="mật khẩu từ dòng lệnh").status_code == 200


def test_the_admin_command_refuses_a_password_that_is_not_utf8_text(real, monkeypatch):
    # Windows PowerShell 5.1 không gửi UTF-8 khi nối ống: thà dừng với lời báo rõ còn hơn băm một chuỗi sai.
    _client, sessions = real

    with pytest.raises(SystemExit) as stopped:
        _create_user_from_stdin(monkeypatch, "mật khẩu từ dòng lệnh".encode("utf-16") + b"\n")

    assert "UTF-8" in str(stopped.value)
    with sessions() as check:
        assert check.scalars(select(AppUser.email)).all() == [EMAIL]


def _create_user_by_typing(monkeypatch, typed: list[str], role: str) -> None:
    from app import cli

    answers = iter(typed)
    monkeypatch.setattr(cli.getpass, "getpass", lambda _prompt: next(answers))
    cli.main(["create-user", "--email", "typed@example.org", "--name", "Người gõ tay", "--role", role])


def test_the_admin_command_asks_for_the_password_twice_and_makes_the_role_it_was_told(real, monkeypatch):
    client, _sessions = real

    _create_user_by_typing(monkeypatch, ["mật khẩu gõ hai lần", "mật khẩu gõ hai lần"], role="admin")

    assert log_in(client, email="typed@example.org", password="mật khẩu gõ hai lần").json()["user"]["role"] == "admin"
    assert client.get("/api/admin/users").status_code == 200


def test_the_admin_command_stops_when_the_two_typed_passwords_differ(real, monkeypatch):
    _client, sessions = real

    with pytest.raises(SystemExit):
        _create_user_by_typing(monkeypatch, ["mật khẩu thứ nhất", "mật khẩu thứ hai"], role="submitter")

    with sessions() as check:
        assert check.scalars(select(AppUser.email)).all() == [EMAIL]
