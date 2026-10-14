"""Nộp mẫu và ẩn mẫu với session thật của ứng dụng: mỗi request một session và một lần commit.

Các test trong `test_submissions_api.py` cho mọi request dùng chung một session, nên không thấy được việc quên commit.
"""

import threading
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from app.accounts import passwords
from app.accounts import service as accounts
from app.geo.seed import seed_geo
from app.models import AuditLog, Job, Sample, Submission
from app.submissions import service

PASSWORD = "mật khẩu đủ dài"
BROWSER = {"X-Requested-With": "vietstrain"}
GENOME = "ACGT" * 2650


@pytest.fixture
def real(engine, monkeypatch):
    from app.main import app

    monkeypatch.setattr(passwords, "N", 2**10)
    accounts.unknown_email_hash.cache_clear()
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions.begin() as setup:
        seed_geo(setup)
        accounts.create_user(setup, email="lab@example.org", display_name="Phòng A", password=PASSWORD)
        accounts.create_user(setup, email="boss@example.org", display_name="Quản trị", password=PASSWORD, role="admin")
    with TestClient(app) as client:
        yield client, sessions
    accounts.unknown_email_hash.cache_clear()
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE sample, job, app_user, audit_log, admin_unit CASCADE"))


def log_in(client, email: str) -> None:
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD}, headers=BROWSER)
    assert response.status_code == 200


def test_a_submission_and_the_hiding_of_a_sample_are_there_for_the_next_request(real):
    client, sessions = real
    log_in(client, "lab@example.org")

    created = client.post(
        "/api/submissions",
        json={
            "displayName": "Hà_Nội/01/2024",
            "collectionDate": "2024-01-15",
            "unitCode": "vn63:ha-noi",
            "host": None,
            "fasta": f">mau\n{GENOME}\n",
        },
        headers=BROWSER,
    )

    assert created.status_code == 201
    internal_id = created.json()["internalId"]
    with sessions() as check:
        sample = check.scalars(select(Sample)).one()
        assert (sample.internal_id, sample.status) == (internal_id, "received")
        # Job đã commit thì worker mới thấy nó.
        assert check.scalars(select(Job.status)).all() == ["queued"]
        assert check.scalars(select(Submission.sample_id)).all() == [sample.id]
    assert client.get("/api/submissions").json()["total"] == 1

    # Một request bị từ chối không để lại gì.
    refused = client.post("/api/submissions", json={"displayName": "x"}, headers=BROWSER)
    assert refused.status_code == 422
    with sessions() as check:
        assert len(check.scalars(select(Sample)).all()) == 1

    with sessions.begin() as change:
        change.scalars(select(Sample)).one().status = "accepted"
    log_in(client, "boss@example.org")

    assert client.post(f"/api/admin/samples/{internal_id}/hide", headers=BROWSER).status_code == 204

    with sessions() as check:
        assert check.scalars(select(Sample.status)).all() == ["hidden"]
        assert "sample_hidden" in check.scalars(select(AuditLog.action)).all()
    assert client.get(f"/api/samples/{internal_id}").status_code == 404


def test_requests_sent_at_the_same_moment_cannot_get_past_the_limit_of_waiting_samples(real, monkeypatch):
    # Trần số mẫu đang chờ được đếm rồi mới ghi. Không khoá thì tám request cùng lúc đều đếm thấy 0 và cùng lọt qua.
    client, sessions = real
    monkeypatch.setattr(service, "MAX_PENDING", 3)
    check_submission = service.check_submission

    def slow_check(**fields):
        time.sleep(0.05)  # nới khoảng giữa lúc đếm và lúc ghi, để cuộc đua lộ ra chắc chắn
        return check_submission(**fields)

    monkeypatch.setattr(service, "check_submission", slow_check)
    log_in(client, "lab@example.org")
    statuses: list[int] = []

    def attempt(number: int):
        # Mỗi lần một chuỗi riêng: lần nộp trùng chuỗi bị hỏi lại, và test này chỉ thử trần số mẫu đang chờ.
        body = submission(GENOME[:-4] + "ACGT"[number % 4] * 2 + "ACGT"[number // 4] * 2)
        statuses.append(client.post("/api/submissions", json=body, headers=BROWSER).status_code)

    threads = [threading.Thread(target=attempt, args=(number,)) for number in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(statuses) == [201] * 3 + [429] * 5
    with sessions() as check:
        assert len(check.scalars(select(Sample)).all()) == 3
        assert len(check.scalars(select(Job)).all()) == 3


def submission(sequence: str = GENOME) -> dict:
    return {
        "displayName": "Hà_Nội/01/2024",
        "collectionDate": "2024-01-15",
        "unitCode": "vn63:ha-noi",
        "host": None,
        "fasta": f">mau\n{sequence}\n",
    }


def test_the_same_sequence_sent_twice_at_the_same_moment_is_taken_once_and_questioned_once(real, monkeypatch):
    # Hai lần nộp của một tài khoản đi lần lượt (khoá dòng tài khoản), nên lần sau thấy mẫu của lần trước. Không
    # khoá thì cả hai cùng không thấy gì và cùng được nhận.
    client, sessions = real
    check_submission = service.check_submission

    def slow_check(**fields):
        time.sleep(0.05)
        return check_submission(**fields)

    monkeypatch.setattr(service, "check_submission", slow_check)
    log_in(client, "lab@example.org")
    statuses: list[int] = []

    def attempt():
        statuses.append(client.post("/api/submissions", json=submission(), headers=BROWSER).status_code)

    threads = [threading.Thread(target=attempt) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(statuses) == [201, 409]
    with sessions() as check:
        assert len(check.scalars(select(Sample)).all()) == 1
