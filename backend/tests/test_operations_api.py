import datetime as dt
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from app.accounts import passwords
from app.accounts import service as accounts
from app.build.pipeline import republish_build
from app.build.publish import builds_root, publish_build
from app.config import settings
from app.geo.seed import seed_geo
from app.jobs import queue
from app.jobs.steps import JobContext
from app.models import AppUser, AuditLog, Build, DatasetDef, Job, JobStep, PlaceAlias, Sample, Submission
from app.operations import jobs
from tests.support import add_sample, make_build

PASSWORD = "mật khẩu đủ dài"
BROWSER = {"X-Requested-With": "vietstrain"}
DAY = {"date_min": dt.date(2019, 3, 15), "date_max": dt.date(2019, 3, 15), "collection_date_raw": "2019-03-15"}


@pytest.fixture(autouse=True)
def prepared(session, monkeypatch):
    monkeypatch.setattr(passwords, "N", 2**10)
    accounts.unknown_email_hash.cache_clear()
    seed_geo(session)
    yield
    accounts.unknown_email_hash.cache_clear()


def make_user(session, email: str, role: str = "submitter"):
    return accounts.create_user(session, email=email, display_name=f"Người dùng {email}", password=PASSWORD, role=role)


def log_in(client, email: str) -> None:
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD}, headers=BROWSER)
    assert response.status_code == 200


@pytest.fixture
def admin(session, client):
    user = make_user(session, "boss@example.org", "admin")
    log_in(client, user.email)
    return user


@pytest.fixture
def data_dir(tmp_path, monkeypatch) -> Path:
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    return tmp_path


def make_dataset(session, slug: str = "dengue-denv1", **fields) -> DatasetDef:
    values = {"title": f"Dengue {slug}", "pathogen": "dengue", "lineage": "denv1", "max_samples": 2000}
    dataset = DatasetDef(slug=slug, **(values | fields))
    session.add(dataset)
    session.flush()
    return dataset


def error_code(response) -> str:
    return response.json()["error"]["code"]


def audit(session) -> list[tuple[str, str | None]]:
    rows = session.execute(select(AuditLog.action, AuditLog.subject).order_by(AuditLog.id)).all()
    return [(action, subject) for action, subject in rows if action != "login"]


# --- Quyền ---

ADMIN_ENDPOINTS = [
    ("GET", "/api/admin/jobs"),
    ("GET", "/api/admin/jobs/1"),
    ("POST", "/api/admin/jobs/1/retry"),
    ("POST", "/api/admin/jobs/1/cancel"),
    ("PATCH", "/api/admin/datasets/dengue-denv1"),
    ("POST", "/api/admin/datasets/dengue-denv1/builds"),
    ("GET", "/api/admin/places/unresolved"),
    ("GET", "/api/admin/places/aliases"),
    ("POST", "/api/admin/places/aliases"),
    ("DELETE", "/api/admin/places/aliases/thuduc"),
]


@pytest.mark.parametrize(("method", "path"), ADMIN_ENDPOINTS)
def test_the_operations_endpoints_are_for_administrators_only(session, client, method, path):
    make_dataset(session)
    failed = queue.enqueue(session, "ingest_sample", {"sample_id": 1})
    failed.status = "failed"
    session.flush()
    path = path.replace("/jobs/1", f"/jobs/{failed.id}")
    body = {"json": {}} if method in ("POST", "PATCH") else {}

    guest = client.request(method, path, headers=BROWSER, **body)
    assert (guest.status_code, error_code(guest)) == (401, "NOT_AUTHENTICATED")

    make_user(session, "lab@example.org")
    log_in(client, "lab@example.org")
    lab = client.request(method, path, headers=BROWSER, **body)
    assert (lab.status_code, error_code(lab)) == (403, "FORBIDDEN")
    # Không có gì được ghi hay xếp hàng.
    assert session.scalar(select(func.count()).select_from(Job)) == 1
    assert session.scalar(select(func.count()).select_from(PlaceAlias).where(PlaceAlias.source == "admin")) == 0
    assert session.get(DatasetDef, session.scalar(select(DatasetDef.id))).build_interval_hours is None


@pytest.mark.parametrize(("method", "path"), [pair for pair in ADMIN_ENDPOINTS if pair[0] != "GET"])
def test_a_write_without_the_header_a_browser_form_cannot_send_is_refused_even_from_an_administrator(
    session, client, admin, method, path
):
    make_dataset(session)
    failed = queue.enqueue(session, "tool_versions")
    failed.status = "failed"
    session.flush()
    path = path.replace("/jobs/1", f"/jobs/{failed.id}")

    response = client.request(
        method, path, json={"buildIntervalHours": 24, "text": "Thu Duc", "unitCode": "vn63:ha-noi"}
    )

    assert (response.status_code, error_code(response)) == (403, "CSRF_HEADER_REQUIRED")
    assert session.scalar(select(func.count()).select_from(Job)) == 1
    assert session.scalar(select(func.count()).select_from(PlaceAlias).where(PlaceAlias.source == "admin")) == 0
    assert session.scalar(select(DatasetDef.build_interval_hours)) is None


# --- Job ---


def finished_job(session, kind: str, status: str, *, seconds: float = 2.0, error: str | None = None, **params) -> Job:
    job = queue.enqueue(session, kind, params)
    started = dt.datetime(2026, 10, 13, 5, 0, tzinfo=dt.UTC)
    job.status, job.worker, job.error = status, "w1", error
    job.started_at, job.finished_at = started, started + dt.timedelta(seconds=seconds)
    session.flush()
    return job


def test_the_job_list_shows_the_newest_first_with_how_the_queue_is_doing(session, client, admin):
    done = finished_job(session, "build_dataset", "succeeded", seconds=412.5, dataset="dengue-denv1")
    broken = finished_job(
        session,
        "ingest_sample",
        "failed",
        error="ToolFailed: nextclade exited with code 1\nlong log\nmore",
        sample_id=7,
    )
    waiting = queue.enqueue(session, "place_pending", {"dataset": "dengue-denv1"}, priority=10)
    session.execute(
        Job.__table__.update().where(Job.id == waiting.id).values(created_at=func.now() - dt.timedelta(minutes=5))
    )
    session.flush()

    body = client.get("/api/admin/jobs").json()

    assert [item["id"] for item in body["items"]] == [waiting.id, broken.id, done.id]
    assert (body["total"], body["limit"], body["offset"]) == (3, 50, 0)
    assert body["counts"] == {"queued": 1, "running": 0, "succeeded": 1, "failed": 1, "cancelled": 0}
    assert 299 <= body["oldestQueuedSeconds"] <= 310
    first, second, third = body["items"]
    assert (first["kind"], first["status"], first["params"], first["priority"]) == (
        "place_pending",
        "queued",
        {"dataset": "dengue-denv1"},
        10,
    )
    assert (first["seconds"], first["worker"], first["error"]) == (None, None, None)
    # Danh sách chỉ mang dòng đầu của lỗi; log đầy đủ nằm ở trang chi tiết.
    assert second["error"] == "ToolFailed: nextclade exited with code 1"
    assert (third["seconds"], third["worker"]) == (412.5, "w1")


def test_the_job_list_filters_by_status_and_kind_and_pages(session, client, admin):
    for number in range(3):
        finished_job(session, "ingest_sample", "failed", sample_id=number)
    finished_job(session, "ingest_sample", "succeeded", sample_id=9)
    finished_job(session, "build_dataset", "failed", dataset="dengue-denv1")

    failed = client.get("/api/admin/jobs?status=failed&kind=ingest_sample&limit=2&offset=1").json()

    assert (failed["total"], len(failed["items"])) == (3, 2)
    assert {item["kind"] for item in failed["items"]} == {"ingest_sample"}
    # Số job theo trạng thái là của cả hàng đợi, không phụ thuộc bộ lọc.
    assert failed["counts"] == {"queued": 0, "running": 0, "succeeded": 1, "failed": 4, "cancelled": 0}
    assert failed["oldestQueuedSeconds"] is None
    assert client.get("/api/admin/jobs?status=exploded").status_code == 422
    assert client.get("/api/admin/jobs?kind=" + "x" * 41).status_code == 422
    assert client.get("/api/admin/jobs?limit=501").status_code == 422


def test_one_job_shows_its_steps_with_their_time_and_log(session, client, admin):
    job = finished_job(session, "build_dataset", "failed", error="ToolFailed: iqtree exited with code 2\ntail")
    job.result = None
    session.add_all(
        [
            JobStep(job_id=job.id, position=1, name="select", status="succeeded", metrics={"wall_seconds": 0.4}),
            JobStep(
                job_id=job.id,
                position=2,
                name="tree",
                status="failed",
                metrics={"wall_seconds": 31.2, "max_rss_mb": 512},
                log_tail="ERROR: alignment has too few sequences",
            ),
        ]
    )
    session.flush()

    body = client.get(f"/api/admin/jobs/{job.id}").json()

    assert (body["id"], body["status"], body["error"]) == (
        job.id,
        "failed",
        "ToolFailed: iqtree exited with code 2\ntail",
    )
    assert [(step["name"], step["status"], step["seconds"]) for step in body["steps"]] == [
        ("select", "succeeded", 0.4),
        ("tree", "failed", 31.2),
    ]
    assert body["steps"][1]["logTail"] == "ERROR: alignment has too few sequences"
    assert (body["retryOf"], body["retriedBy"]) == (None, None)
    missing = client.get("/api/admin/jobs/999999")
    assert (missing.status_code, error_code(missing)) == (404, "JOB_NOT_FOUND")


def submitted_sample(session, user) -> tuple[Sample, Job]:
    """Một mẫu vừa nộp mà job kiểm tra của nó đã hỏng."""
    sample = add_sample(session, source="submission", status="received", accession=None)
    job = queue.enqueue(session, "ingest_sample", {"sample_id": sample.id}, priority=queue.INTERACTIVE)
    job.status, job.error = "failed", "ToolTimeout: nextclade did not finish within 600 seconds"
    session.add(Submission(sample_id=sample.id, submitter_id=user.id, job_id=job.id))
    session.flush()
    return sample, job


def test_retrying_a_failed_check_gets_the_sample_moving_again(session, client, admin):
    sample, broken = submitted_sample(session, admin)
    assert client.get(f"/api/submissions/{sample.internal_id}").json()["stage"] == "failed"

    response = client.post(f"/api/admin/jobs/{broken.id}/retry", headers=BROWSER)

    assert response.status_code == 201
    new = session.get(Job, response.json()["id"])
    assert (new.kind, new.params, new.priority, new.status) == (
        "ingest_sample",
        {"sample_id": sample.id},
        queue.INTERACTIVE,
        "queued",
    )
    assert (new.retry_of, new.id != broken.id) == (broken.id, True)
    # Lần nộp trỏ sang job mới, nên người nộp thấy mẫu lại đang được kiểm tra.
    session.expire_all()
    assert session.get(Submission, sample.id).job_id == new.id
    assert client.get(f"/api/submissions/{sample.internal_id}").json()["stage"] == "processing"
    # Job cũ còn nguyên để tra cứu, và biết nó đã được chạy lại bằng job nào.
    assert (broken.status, broken.error.startswith("ToolTimeout")) == ("failed", True)
    old = client.get(f"/api/admin/jobs/{broken.id}").json()
    assert (old["retriedBy"], client.get(f"/api/admin/jobs/{new.id}").json()["retryOf"]) == (new.id, broken.id)
    assert audit(session)[-1] == ("job_retried", f"job:{broken.id}")


def test_only_a_failed_job_can_be_retried_and_only_once(session, client, admin):
    _, broken = submitted_sample(session, admin)
    running = queue.enqueue(session, "align_pending", {"lineage": "denv1"})
    done = finished_job(session, "tool_versions", "succeeded")

    for job in (running, done):
        refused = client.post(f"/api/admin/jobs/{job.id}/retry", headers=BROWSER)
        assert (refused.status_code, error_code(refused)) == (409, "JOB_NOT_FAILED")

    assert client.post(f"/api/admin/jobs/{broken.id}/retry", headers=BROWSER).status_code == 201
    again = client.post(f"/api/admin/jobs/{broken.id}/retry", headers=BROWSER)
    assert (again.status_code, error_code(again)) == (409, "JOB_ALREADY_RETRIED")
    missing = client.post("/api/admin/jobs/999999/retry", headers=BROWSER)
    assert (missing.status_code, error_code(missing)) == (404, "JOB_NOT_FOUND")
    assert session.scalar(select(func.count()).select_from(Job).where(Job.retry_of.is_not(None))) == 1


def test_a_failed_build_is_not_retried_while_another_build_of_the_dataset_is_waiting(session, client, admin):
    make_dataset(session)
    broken = finished_job(session, "build_dataset", "failed", dataset="dengue-denv1")
    waiting = queue.enqueue(session, "build_dataset", {"dataset": "dengue-denv1"})

    refused = client.post(f"/api/admin/jobs/{broken.id}/retry", headers=BROWSER)

    assert (refused.status_code, error_code(refused)) == (409, "BUILD_ALREADY_WAITING")
    waiting.status = "succeeded"
    session.flush()
    assert client.post(f"/api/admin/jobs/{broken.id}/retry", headers=BROWSER).status_code == 201


def test_two_administrators_retrying_the_same_job_at_once_get_one_new_job(committed, engine, monkeypatch):
    # Hai lần bấm cùng lúc đều thấy "chưa ai chạy lại job này". Không khoá dòng của job thì cả hai cùng xếp job mới,
    # và ràng buộc duy nhất của `retry_of` biến lần thứ hai thành một lỗi 500 thay vì một lời từ chối.
    with committed.begin() as session:
        boss = accounts.create_user(session, email="boss@example.org", display_name="Quản trị", password=PASSWORD)
        failed = queue.enqueue(session, "tool_versions")
        failed.status = "failed"
        boss_id, failed_id = boss.id, failed.id
    enqueue = queue.enqueue

    def slow_enqueue(*arguments, **options):
        time.sleep(0.2)  # nới khoảng giữa lúc xét và lúc xếp job, để cuộc đua lộ ra chắc chắn
        return enqueue(*arguments, **options)

    monkeypatch.setattr(queue, "enqueue", slow_enqueue)
    start = threading.Barrier(4)

    def attempt(_: int) -> str:
        with committed() as session:
            actor = session.get(AppUser, boss_id)
            start.wait()
            try:
                jobs.retry(session, actor, failed_id)
            except jobs.AlreadyRetried:
                session.rollback()
                return "already retried"
            session.commit()
            return "queued"

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            outcomes = sorted(pool.map(attempt, range(4)))
        with committed() as session:
            retries = session.scalars(select(Job.id).where(Job.retry_of == failed_id)).all()

        assert outcomes == ["already retried"] * 3 + ["queued"]
        assert len(retries) == 1
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE job, app_user, audit_log CASCADE"))


# --- Lịch của dataset ---


def test_an_administrator_sets_and_clears_the_build_schedule_of_a_dataset(session, client, admin):
    dataset = make_dataset(session)
    assert client.get("/api/datasets").json()["items"][0]["buildIntervalHours"] is None

    response = client.patch("/api/admin/datasets/dengue-denv1", json={"buildIntervalHours": 24}, headers=BROWSER)

    assert (response.status_code, response.json()["buildIntervalHours"]) == (200, 24)
    session.expire_all()
    assert dataset.build_interval_hours == 24
    # Ai cũng xem được cây được cập nhật bao lâu một lần.
    assert client.get("/api/datasets/dengue-denv1").json()["buildIntervalHours"] == 24
    assert audit(session)[-1] == ("dataset_schedule_changed", "dataset:dengue-denv1")

    cleared = client.patch("/api/admin/datasets/dengue-denv1", json={"buildIntervalHours": None}, headers=BROWSER)
    session.expire_all()
    assert (cleared.status_code, dataset.build_interval_hours) == (200, None)


@pytest.mark.parametrize(
    "body",
    [
        {"buildIntervalHours": 0},
        {"buildIntervalHours": -24},
        {"buildIntervalHours": 8761},
        {"buildIntervalHours": "x"},
        # Những thứ một bộ đọc dễ dãi sẽ ép thành số giờ: chuỗi chứa số, số lẻ, `true`.
        {"buildIntervalHours": "24"},
        {"buildIntervalHours": 1.5},
        {"buildIntervalHours": True},
        {},
    ],
)
def test_a_schedule_that_makes_no_sense_is_refused(session, client, admin, body):
    dataset = make_dataset(session, build_interval_hours=12)

    response = client.patch("/api/admin/datasets/dengue-denv1", json=body, headers=BROWSER)

    session.expire_all()
    assert (response.status_code, dataset.build_interval_hours) == (422, 12)


def test_an_administrator_asks_for_a_build_now_but_not_for_two_at_once(session, client, admin):
    make_dataset(session)

    response = client.post("/api/admin/datasets/dengue-denv1/builds", headers=BROWSER)

    assert response.status_code == 202
    job = session.get(Job, response.json()["id"])
    assert (job.kind, job.params, job.status) == ("build_dataset", {"dataset": "dengue-denv1"}, "queued")
    assert audit(session)[-1] == ("build_requested", "dataset:dengue-denv1")
    again = client.post("/api/admin/datasets/dengue-denv1/builds", headers=BROWSER)
    assert (again.status_code, error_code(again)) == (409, "BUILD_ALREADY_WAITING")
    for path in ("/api/admin/datasets/no-such-dataset/builds", "/api/admin/datasets/x'; DROP TABLE job;--/builds"):
        missing = client.post(path, headers=BROWSER)
        assert (missing.status_code, error_code(missing)) == (404, "DATASET_NOT_FOUND")
    unknown = client.patch("/api/admin/datasets/no-such-dataset", json={"buildIntervalHours": 24}, headers=BROWSER)
    assert (unknown.status_code, error_code(unknown)) == (404, "DATASET_NOT_FOUND")


# --- Địa danh ---


def unresolved(session, division: str | None, location: str | None = None, **fields) -> Sample:
    values = {"division_raw": division, "location_raw": location, "geo_status": "unresolved"}
    return add_sample(session, **(DAY | values | fields))


def in_hanoi(session) -> Sample:
    """Một bản ghi đã được phân giải đúng: việc phân giải lại không có gì để đổi ở nó."""
    place = {"admin_unit_code": "vn63:ha-noi", "region_code": "vnr:red-river-delta", "geo_status": "province"}
    return add_sample(session, division_raw="Ha Noi", **(DAY | place))


def test_the_unresolved_spellings_are_listed_with_how_many_samples_use_each(session, client, admin):
    for _ in range(3):
        unresolved(session, "Thu Duc")
    unresolved(session, "THUDUC")
    unresolved(session, "Cu Chi", "Thot Not")
    unresolved(session, "Thu Duc", country="Thailand", geo_status="foreign")
    in_hanoi(session)
    add_sample(session, geo_status="missing")

    body = client.get("/api/admin/places/unresolved").json()

    # Các cách viết cùng khoá được gộp lại; mẫu có cả hai trường được tính ở cả hai cách viết.
    assert body["items"] == [
        {"key": "thuduc", "text": "Thu Duc", "spellings": ["Thu Duc", "THUDUC"], "samples": 4},
        {"key": "cuchi", "text": "Cu Chi", "spellings": ["Cu Chi"], "samples": 1},
        {"key": "thotnot", "text": "Thot Not", "spellings": ["Thot Not"], "samples": 1},
    ]
    assert body["samples"] == 5


def add_alias(client, text: str, unit_code: str):
    return client.post("/api/admin/places/aliases", json={"text": text, "unitCode": unit_code}, headers=BROWSER)


def test_adding_an_alias_resolves_the_samples_that_use_that_spelling(session, client, admin):
    old = [unresolved(session, "Thu Duc"), unresolved(session, None, "THUDUC")]
    # Mẫu lấy sau ngày sáp nhập được gán đơn vị kế thừa, như lúc nhập.
    late = unresolved(session, "Thu Duc", date_min=dt.date(2025, 8, 1), date_max=dt.date(2025, 8, 1))
    other = unresolved(session, "Cu Chi")

    response = add_alias(client, "Thủ Đức", "vn63:ho-chi-minh")

    assert response.status_code == 201
    assert response.json() == {
        "key": "thuduc",
        "text": "Thủ Đức",
        "unitCode": "vn63:ho-chi-minh",
        "changedSamples": 3,
        "republished": [],
    }
    session.expire_all()
    for sample in old:
        assert (sample.geo_status, sample.admin_unit_code, sample.region_code) == (
            "province",
            "vn63:ho-chi-minh",
            "vnr:southeast",
        )
    assert (late.geo_status, late.admin_unit_code) == ("province", "vn34:ho-chi-minh")
    assert (other.geo_status, other.admin_unit_code) == ("unresolved", None)
    alias = session.get(PlaceAlias, "thuduc")
    assert (alias.unit_code, alias.kind, alias.source, alias.example) == (
        "vn63:ho-chi-minh",
        "variant",
        "admin",
        "Thủ Đức",
    )
    assert audit(session)[-1] == ("place_alias_added", "place:thuduc")
    assert client.get("/api/admin/places/aliases").json()["items"] == [
        {"key": "thuduc", "text": "Thủ Đức", "unitCode": "vn63:ho-chi-minh", "unitName": "Hồ Chí Minh"}
    ]


def test_a_sample_submitted_by_a_lab_keeps_the_province_the_lab_chose(session, client, admin):
    # Tỉnh của mẫu nộp do người nộp chọn từ danh sách; địa danh gốc của nó chỉ là tên của tỉnh đó.
    submitted = add_sample(
        session,
        source="submission",
        accession=None,
        division_raw="Thu Duc",
        admin_unit_code="vn63:ha-noi",
        region_code="vnr:red-river-delta",
        geo_status="province",
        **DAY,
    )
    unresolved(session, "Thu Duc")

    assert add_alias(client, "Thu Duc", "vn63:ho-chi-minh").json()["changedSamples"] == 1

    session.expire_all()
    assert (submitted.admin_unit_code, submitted.region_code) == ("vn63:ha-noi", "vnr:red-river-delta")


@pytest.mark.parametrize(
    ("text", "unit_code", "status", "code"),
    [
        ("---", "vn63:ho-chi-minh", 422, "EMPTY_PLACE"),
        ("Thu Duc", "vn63:no-such-province", 422, "UNKNOWN_UNIT"),
        ("Thu Duc", "'; DROP TABLE sample;--", 422, "UNKNOWN_UNIT"),
        ("Hà Nội", "vn63:ho-chi-minh", 409, "ALIAS_EXISTS"),  # tên chính của Hà Nội, có sẵn từ seed
        ("x" * 201, "vn63:ho-chi-minh", 422, "VALIDATION_ERROR"),
    ],
)
def test_an_alias_that_cannot_be_right_is_refused(session, client, admin, text, unit_code, status, code):
    sample = unresolved(session, "Thu Duc")
    before = session.scalar(select(func.count()).select_from(PlaceAlias))

    response = add_alias(client, text, unit_code)

    session.expire_all()
    assert (response.status_code, error_code(response)) == (status, code)
    assert session.scalar(select(func.count()).select_from(PlaceAlias)) == before
    assert sample.geo_status == "unresolved"


def publish_jobs(session) -> list[dict]:
    return [job.params for job in session.scalars(select(Job).where(Job.kind == "publish_build").order_by(Job.id))]


def test_an_alias_republishes_the_trees_that_hold_changed_samples_without_rebuilding_them(
    session, client, admin, data_dir, tmp_path
):
    changed = unresolved(session, "Thu Duc")
    untouched = in_hanoi(session)
    with_change = make_dataset(session, "dengue-denv1")
    without = make_dataset(session, "dengue-denv1-north")
    build = make_build(session, with_change, [changed, untouched], builds_root(), tmp_path)
    other_build = make_build(session, without, [untouched], builds_root(), tmp_path)
    before = publish_build(session, build)
    publish_build(session, other_build)

    response = add_alias(client, "Thu Duc", "vn63:ho-chi-minh")

    # Chỉ dataset có mẫu vừa đổi được publish lại, và việc đó là một job publish, không phải job dựng cây.
    assert response.json()["republished"] == ["dengue-denv1"]
    assert publish_jobs(session) == [{"build_id": build.id}]
    assert session.scalar(select(func.count()).select_from(Job).where(Job.kind == "build_dataset")) == 0

    result = republish_build(JobContext(session=session, job=queue.claim(session, "w1"), work_dir=tmp_path))

    session.expire_all()
    after = result["path"]
    assert after != before and build.path == after and build.is_current
    old, new = builds_root() / before, builds_root() / after
    # Cây giữ nguyên từng byte; chỉ cột địa bàn đổi.
    assert (new / "tree.json").read_bytes() == (old / "tree.json").read_bytes()
    assert (new / "auspice.json").read_bytes() == (old / "auspice.json").read_bytes()
    assert "vn63:ho-chi-minh" not in json.loads((old / "col.unit.json").read_text())["values"]
    assert "vn63:ho-chi-minh" in json.loads((new / "col.unit.json").read_text())["values"]
    # Bản publish cũ vẫn còn: trình duyệt đang mở nó không bị hỏng giữa chừng.
    assert (old / "manifest.json").is_file()


def test_a_tree_already_waiting_to_be_republished_is_not_queued_twice(session, client, admin, data_dir, tmp_path):
    first, second = unresolved(session, "Thu Duc"), unresolved(session, "Cu Chi")
    build = make_build(session, make_dataset(session), [first, second], builds_root(), tmp_path)
    publish_build(session, build)

    add_alias(client, "Thu Duc", "vn63:ho-chi-minh")
    response = add_alias(client, "Cu Chi", "vnr:southeast")

    assert response.json()["republished"] == ["dengue-denv1"]
    assert publish_jobs(session) == [{"build_id": build.id}]
    session.expire_all()
    # Gán cho một vùng: mẫu có vùng, không có tỉnh.
    assert (second.geo_status, second.admin_unit_code, second.region_code) == ("region", None, "vnr:southeast")


def test_a_tree_waiting_to_be_republished_does_not_stand_in_for_another_tree(
    session, client, admin, data_dir, tmp_path
):
    first, second = unresolved(session, "Thu Duc"), unresolved(session, "Cu Chi")
    south = make_build(session, make_dataset(session, "dengue-denv1"), [first], builds_root(), tmp_path)
    north = make_build(session, make_dataset(session, "dengue-denv1-north"), [second], builds_root(), tmp_path)
    publish_build(session, south)
    publish_build(session, north)

    add_alias(client, "Thu Duc", "vn63:ho-chi-minh")
    response = add_alias(client, "Cu Chi", "vnr:southeast")

    # Job đang chờ là của cây kia; cây này vẫn phải được publish lại.
    assert response.json()["republished"] == ["dengue-denv1-north"]
    assert publish_jobs(session) == [{"build_id": south.id}, {"build_id": north.id}]


def test_an_alias_added_by_an_administrator_can_be_taken_back_but_a_seeded_one_cannot(session, client, admin):
    sample = unresolved(session, "Thu Duc")
    add_alias(client, "Thu Duc", "vn63:ho-chi-minh")

    removed = client.delete("/api/admin/places/aliases/thuduc", headers=BROWSER)

    assert (removed.status_code, removed.json()["changedSamples"]) == (200, 1)
    session.expire_all()
    assert session.get(PlaceAlias, "thuduc") is None
    assert (sample.geo_status, sample.admin_unit_code, sample.region_code) == ("unresolved", None, None)
    assert audit(session)[-1] == ("place_alias_removed", "place:thuduc")

    seeded = client.delete("/api/admin/places/aliases/hanoi", headers=BROWSER)
    assert (seeded.status_code, error_code(seeded)) == (409, "SEED_ALIAS")
    assert session.get(PlaceAlias, "hanoi") is not None
    missing = client.delete("/api/admin/places/aliases/nowhere", headers=BROWSER)
    assert (missing.status_code, error_code(missing)) == (404, "ALIAS_NOT_FOUND")


def test_a_spelling_in_another_script_can_be_mapped_and_taken_back(session, client, admin):
    # `place_key` giữ mọi chữ và số, không riêng a-z: khoá của một cách viết bằng chữ Kirin là chữ Kirin (đã bỏ dấu).
    sample = unresolved(session, "Ханой")

    added = add_alias(client, "Ханой", "vn63:ha-noi")

    assert (added.status_code, added.json()["key"], added.json()["changedSamples"]) == (201, "ханои", 1)
    removed = client.delete("/api/admin/places/aliases/ханои", headers=BROWSER)
    assert (removed.status_code, removed.json()["changedSamples"]) == (200, 1)
    session.expire_all()
    assert session.get(PlaceAlias, "ханои") is None
    assert sample.geo_status == "unresolved"


def test_a_spelling_whose_key_does_not_fit_is_refused_rather_than_failing(session, client, admin):
    before = session.scalar(select(func.count()).select_from(PlaceAlias))

    fits = add_alias(client, "a" * 80, "vn63:ha-noi")
    too_long = add_alias(client, "b" * 81, "vn63:ha-noi")

    assert fits.status_code == 201
    assert (too_long.status_code, error_code(too_long)) == (422, "PLACE_TOO_LONG")
    assert session.scalar(select(func.count()).select_from(PlaceAlias)) == before + 1


@pytest.mark.parametrize("key", ["thu%20duc", "thu-duc", "a" * 101, "thuduc%00", "%27%3B--"])
def test_a_key_no_alias_can_have_is_not_found(session, client, admin, key):
    add_alias(client, "Thu Duc", "vn63:ho-chi-minh")

    response = client.delete(f"/api/admin/places/aliases/{key}", headers=BROWSER)

    assert (response.status_code, error_code(response)) == (404, "ALIAS_NOT_FOUND")
    assert session.get(PlaceAlias, "thuduc") is not None


def test_resolving_again_does_not_touch_samples_from_other_countries_or_ones_with_nothing_to_resolve(
    session, client, admin
):
    foreign = add_sample(session, country="Thailand", division_raw="Thu Duc", geo_status="foreign", **DAY)
    empty = add_sample(session, geo_status="missing", **DAY)
    resolved = add_sample(
        session,
        division_raw="Ha Noi",
        admin_unit_code="vn63:ha-noi",
        region_code="vnr:red-river-delta",
        geo_status="province",
        **DAY,
    )

    assert add_alias(client, "Thu Duc", "vn63:ho-chi-minh").json()["changedSamples"] == 0

    session.expire_all()
    assert (foreign.geo_status, foreign.admin_unit_code) == ("foreign", None)
    assert (empty.geo_status, empty.admin_unit_code) == ("missing", None)
    assert (resolved.geo_status, resolved.admin_unit_code) == ("province", "vn63:ha-noi")
    assert session.scalar(select(func.count()).select_from(Build)) == 0


# --- Huỷ job ---


def cancel(client, job_id: int):
    return client.post(f"/api/admin/jobs/{job_id}/cancel", headers=BROWSER)


def cancellations(session) -> list[tuple[int | None, str | None, dict]]:
    rows = session.execute(
        select(AuditLog.actor_id, AuditLog.subject, AuditLog.detail)
        .where(AuditLog.action == "job_cancelled")
        .order_by(AuditLog.id)
    )
    return [tuple(row) for row in rows]


def test_cancelling_a_waiting_job_takes_it_out_of_the_queue(session, client, admin):
    make_dataset(session)
    waiting = queue.enqueue(session, "build_dataset", {"dataset": "dengue-denv1"})

    response = cancel(client, waiting.id)

    assert response.status_code == 200
    assert (response.json()["id"], response.json()["status"]) == (waiting.id, "cancelled")
    session.expire_all()
    assert (waiting.status, waiting.started_at, waiting.finished_at is not None) == ("cancelled", None, True)
    assert queue.claim(session, "w1") is None
    assert cancellations(session) == [(admin.id, f"job:{waiting.id}", {"was": "queued"})]
    # Dataset không còn job dựng cây nào chưa xong: xin dựng lại được ngay.
    assert client.post("/api/admin/datasets/dengue-denv1/builds", headers=BROWSER).status_code == 202


def test_cancelling_a_running_job_closes_it_at_once_and_what_the_worker_writes_later_is_dropped(session, client, admin):
    queue.enqueue(session, "align_pending", {"lineage": "denv1"})
    running = queue.claim(session, "w1")

    response = cancel(client, running.id)

    assert (response.status_code, response.json()["status"]) == (200, "cancelled")
    session.expire_all()
    assert (running.status, running.finished_at is not None) == ("cancelled", True)
    assert cancellations(session) == [(admin.id, f"job:{running.id}", {"was": "running"})]
    # Worker chưa kịp biết và làm xong việc: kết cục đã ghi không bị đè.
    assert queue.finish(session, running, {"aligned": 3}) is False
    assert queue.fail(session, running, "RuntimeError: too late") is False
    session.expire_all()
    assert (running.status, running.result, running.error) == ("cancelled", None, None)


def test_a_job_that_has_ended_cannot_be_cancelled(session, client, admin):
    for status in ("succeeded", "failed", "cancelled"):
        ended = finished_job(session, "tool_versions", status)

        refused = cancel(client, ended.id)

        assert (refused.status_code, error_code(refused)) == (409, "JOB_ALREADY_FINISHED")
        session.expire_all()
        assert ended.status == status
    missing = cancel(client, 999999)
    assert (missing.status_code, error_code(missing)) == (404, "JOB_NOT_FOUND")
    assert cancellations(session) == []


def test_a_cancelled_check_shows_as_failed_to_the_lab_and_can_be_run_again_once(session, client, admin):
    sample, job = submitted_sample(session, admin)
    job.status, job.error = "queued", None
    session.flush()
    assert client.get(f"/api/submissions/{sample.internal_id}").json()["stage"] == "processing"

    assert cancel(client, job.id).status_code == 200

    assert client.get(f"/api/submissions/{sample.internal_id}").json()["stage"] == "failed"
    again = client.post(f"/api/admin/jobs/{job.id}/retry", headers=BROWSER)
    assert again.status_code == 201
    new = session.get(Job, again.json()["id"])
    assert (new.status, new.retry_of, new.params) == ("queued", job.id, {"sample_id": sample.id})
    assert client.get(f"/api/submissions/{sample.internal_id}").json()["stage"] == "processing"
    twice = client.post(f"/api/admin/jobs/{job.id}/retry", headers=BROWSER)
    assert (twice.status_code, error_code(twice)) == (409, "JOB_ALREADY_RETRIED")


def test_the_job_list_counts_cancelled_jobs_and_filters_by_them(session, client, admin):
    cancelled = finished_job(session, "build_dataset", "cancelled", dataset="dengue-denv1")
    finished_job(session, "tool_versions", "failed", error="RuntimeError: x")
    queue.enqueue(session, "tool_versions")

    everything = client.get("/api/admin/jobs").json()
    only = client.get("/api/admin/jobs", params={"status": "cancelled"}).json()

    assert everything["counts"] == {"queued": 1, "running": 0, "succeeded": 0, "failed": 1, "cancelled": 1}
    assert [item["id"] for item in only["items"]] == [cancelled.id]
    assert (only["total"], only["items"][0]["status"]) == (1, "cancelled")


def test_a_cancellation_is_saved_from_one_request_to_the_next(engine):
    # Fixture `client` dùng chung một session nên không thấy được việc quên commit; ở đây mỗi request một session.
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker

    from app.main import app

    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions.begin() as setup:
        accounts.create_user(setup, email="boss@example.org", display_name="Quản trị", password=PASSWORD, role="admin")
        job_id = queue.enqueue(setup, "tool_versions").id
    try:
        with TestClient(app) as real:
            log_in(real, "boss@example.org")
            assert cancel(real, job_id).status_code == 200
            assert real.get(f"/api/admin/jobs/{job_id}").json()["status"] == "cancelled"
        with sessions() as check:
            assert check.get(Job, job_id).status == "cancelled"
            assert (
                check.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "job_cancelled")) == 1
            )
            assert queue.claim(check, "w1") is None
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE job, app_user, audit_log CASCADE"))


def test_a_job_that_ends_while_it_is_being_cancelled_keeps_one_outcome(committed, engine, monkeypatch):
    # Lệnh huỷ đọc thấy job đang chạy; đúng lúc đó worker ghi "xong" kèm kết quả. Không khoá dòng của job thì lệnh huỷ
    # ghi đè lên: một job mang tình trạng "đã huỷ" mà lại có kết quả của một lần chạy trọn vẹn.
    with committed.begin() as session:
        boss = accounts.create_user(session, email="boss@example.org", display_name="Quản trị", password=PASSWORD)
        queue.enqueue(session, "tool_versions")
        boss_id = boss.id
    with committed() as session:
        job_id = queue.claim(session, "w1").id
    read = threading.Event()
    go_on = threading.Event()
    record = jobs.record

    def slow_record(*arguments, **options):
        read.set()  # lệnh huỷ đã đọc job và sắp ghi
        go_on.wait(10)
        return record(*arguments, **options)

    monkeypatch.setattr(jobs, "record", slow_record)
    finished: list[bool] = []

    def cancel_it() -> None:
        with committed() as session:
            jobs.cancel(session, session.get(AppUser, boss_id), job_id)
            session.commit()

    def finish_it() -> None:
        with committed() as session:
            finished.append(queue.finish(session, session.get(Job, job_id), {"versions": "..."}))

    canceller = threading.Thread(target=cancel_it)
    worker = threading.Thread(target=finish_it)
    try:
        canceller.start()
        assert read.wait(10)
        worker.start()
        worker.join(0.5)
        waited = worker.is_alive()  # worker phải chờ lệnh huỷ ghi xong
        go_on.set()
        canceller.join(10)
        worker.join(10)

        with committed() as session:
            job = session.get(Job, job_id)
            assert waited
            assert finished == [False]
            assert (job.status, job.result) == ("cancelled", None)
    finally:
        go_on.set()
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE job, app_user, audit_log CASCADE"))
