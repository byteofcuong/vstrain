import datetime as dt
import hashlib
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.accounts import passwords
from app.accounts import service as accounts
from app.build.publish import publish_build
from app.config import settings
from app.geo.seed import seed_geo
from app.jobs import queue
from app.models import (
    AuditLog,
    BuildSample,
    DatasetDef,
    Job,
    Sample,
    SampleAlignment,
    SamplePlacement,
    SampleSequence,
    Submission,
)
from app.submissions import service
from app.submissions.validate import MAX_FASTA_CHARS
from tests.support import add_sample, make_build

PASSWORD = "mật khẩu đủ dài"
BROWSER = {"X-Requested-With": "vietstrain"}
GENOME = "ACGT" * 2650  # 10.600 nucleotide: nằm trong khoảng độ dài của một genome dengue


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
def lab(session, client):
    user = make_user(session, "lab@example.org")
    log_in(client, user.email)
    return user


def payload(**changes) -> dict:
    body = {
        "displayName": "Hà_Nội/01/2024",
        "collectionDate": "2024-01-15",
        "unitCode": "vn63:ha-noi",
        "host": "Homo sapiens",
        "fasta": f">ten trong file\n{GENOME}\n",
    }
    return body | changes


def submit(client, **changes):
    return client.post("/api/submissions", json=payload(**changes), headers=BROWSER)


def codes(response) -> list[tuple[str, str]]:
    return [(detail["field"], detail["code"]) for detail in response.json()["error"]["details"]]


def counts(session) -> tuple[int, int, int]:
    return tuple(session.scalar(select(func.count()).select_from(table)) for table in (Sample, Submission, Job))


# --- Nộp ---


def test_submitting_needs_a_login(session, client):
    response = submit(client)

    assert (response.status_code, response.json()["error"]["code"]) == (401, "NOT_AUTHENTICATED")
    assert counts(session) == (0, 0, 0)


def test_a_submission_is_stored_as_received_and_queued_for_checking(session, client, lab):
    response = submit(client)

    assert response.status_code == 201
    body = response.json()
    sample = session.scalars(select(Sample)).one()
    assert body["internalId"] == sample.internal_id and sample.internal_id.startswith("S")
    assert (body["status"], body["stage"]) == ("received", "processing")
    assert (body["displayName"], body["collectionDate"], body["unitCode"]) == (
        "Hà_Nội/01/2024",
        "2024-01-15",
        "vn63:ha-noi",
    )
    assert (body["sequenceLength"], body["placements"], body["inDatasets"]) == (len(GENOME), [], [])

    # Mẫu: của Việt Nam, đúng tỉnh và vùng của tỉnh đó, ngày thành một khoảng.
    assert (sample.source, sample.status, sample.pathogen, sample.country) == (
        "submission",
        "received",
        "dengue",
        "Vietnam",
    )
    assert (sample.admin_unit_code, sample.region_code, sample.geo_status) == (
        "vn63:ha-noi",
        "vnr:red-river-delta",
        "province",
    )
    assert (sample.date_min, sample.date_max, sample.host) == (
        dt.date(2024, 1, 15),
        dt.date(2024, 1, 15),
        "Homo sapiens",
    )
    stored = session.scalars(select(SampleSequence)).one()
    assert (stored.sample_id, stored.sequence, stored.length) == (sample.id, GENOME, len(GENOME))
    assert stored.sha256 == hashlib.sha256(GENOME.encode()).hexdigest()

    # Lần nộp ghi người nộp và job kiểm tra; job đứng trước job dựng cây trong hàng đợi.
    submission = session.scalars(select(Submission)).one()
    job = session.scalars(select(Job)).one()
    assert (submission.sample_id, submission.submitter_id, submission.job_id) == (sample.id, lab.id, job.id)
    assert (job.kind, job.params, job.status) == ("ingest_sample", {"sample_id": sample.id}, "queued")
    queue.enqueue(session, "build_dataset", {"dataset": "dengue-denv1"})
    assert queue.lock_next(session).id == job.id

    logged = session.execute(
        select(AuditLog.actor_id, AuditLog.subject).where(AuditLog.action == "sample_submitted")
    ).one()
    assert tuple(logged) == (lab.id, f"sample:{sample.internal_id}")


def test_the_name_typed_by_the_lab_never_becomes_the_id_the_tools_see(session, client, lab):
    name = "Hà_Nội/01/2024; touch pwned $(id) > 'x'"

    body = submit(client, displayName=name).json()

    assert body["displayName"] == name
    assert body["internalId"].isascii() and body["internalId"].isalnum()


def test_a_sample_just_submitted_is_not_public_yet(client, lab):
    internal_id = submit(client).json()["internalId"]

    assert client.get(f"/api/samples/{internal_id}").status_code == 404
    assert client.get("/api/samples").json()["total"] == 0


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"fasta": "đây không phải FASTA"}, ("fasta", "NOT_FASTA")),
        ({"fasta": ">mau\n" + "ACGT" * 100}, ("fasta", "SEQUENCE_TOO_SHORT")),
        ({"fasta": ">mau\n" + "ACGT" * 3000}, ("fasta", "SEQUENCE_TOO_LONG")),
        ({"fasta": ">mau\n" + GENOME[:5000] + "!" + GENOME[5000:]}, ("fasta", "INVALID_CHARACTERS")),
        ({"fasta": f">mot\n{GENOME}\n>hai\n{GENOME}\n"}, ("fasta", "MULTIPLE_SEQUENCES")),
        ({"fasta": ">mau\n" + "N" * 10_600}, ("fasta", "TOO_FEW_KNOWN_BASES")),
        ({"fasta": ">mau\n" + "A" * (MAX_FASTA_CHARS + 10)}, ("fasta", "FASTA_TOO_LARGE")),
        ({"displayName": "hai\ndòng"}, ("displayName", "INVALID_NAME")),
        ({"collectionDate": "2099-01-01"}, ("collectionDate", "DATE_IN_FUTURE")),
        ({"collectionDate": "15/01/2024"}, ("collectionDate", "INVALID_DATE")),
        ({"host": "Homo\nsapiens"}, ("host", "INVALID_HOST")),
        ({"unitCode": "vn63:atlantis"}, ("unitCode", "UNKNOWN_UNIT")),
        ({"unitCode": "vnr:red-river-delta"}, ("unitCode", "UNKNOWN_UNIT")),  # một vùng, không phải tỉnh
        ({"unitCode": "x\x00y"}, ("unitCode", "UNKNOWN_UNIT")),
        ({"unitCode": "'; DROP TABLE sample; --"}, ("unitCode", "UNKNOWN_UNIT")),
        # Bộ 34 đơn vị có hiệu lực từ 2025-07-01; bộ 63 tỉnh hết hiệu lực ngày 2025-06-30.
        ({"unitCode": "vn34:ha-noi", "collectionDate": "2024-01-15"}, ("unitCode", "UNIT_NOT_VALID_ON_DATE")),
        ({"unitCode": "vn34:ha-noi", "collectionDate": "2025-06-30"}, ("unitCode", "UNIT_NOT_VALID_ON_DATE")),
        ({"unitCode": "vn63:ha-noi", "collectionDate": "2025-07-01"}, ("unitCode", "UNIT_NOT_VALID_ON_DATE")),
        ({"unitCode": "vn63:ha-noi", "collectionDate": "2026"}, ("unitCode", "UNIT_NOT_VALID_ON_DATE")),
    ],
)
def test_a_bad_submission_is_refused_with_the_reason_and_nothing_is_stored(session, client, lab, changes, expected):
    response = submit(client, **changes)

    assert (response.status_code, response.json()["error"]["code"]) == (422, "VALIDATION_ERROR")
    assert codes(response) == [expected]
    assert counts(session) == (0, 0, 0)


@pytest.mark.parametrize(
    ("unit", "date"),
    [
        ("vn63:ha-noi", "2025-06-30"),
        ("vn34:ha-noi", "2025-07-01"),
        # Chỉ biết năm 2025: mẫu có thể được lấy trước hoặc sau ngày sáp nhập, nên cả hai bộ đều hợp lệ.
        ("vn63:ha-noi", "2025"),
        ("vn34:ha-noi", "2025"),
        ("vn63:ha-noi", "2025-06"),
        ("vn34:ha-noi", "2025-07"),
    ],
)
def test_a_province_is_accepted_when_it_existed_at_some_point_of_the_collection_date(client, lab, unit, date):
    response = submit(client, unitCode=unit, collectionDate=date)

    assert response.status_code == 201
    assert response.json()["unitCode"] == unit


def test_a_province_of_the_new_set_has_no_region_yet(session, client, lab):
    submit(client, unitCode="vn34:ha-noi", collectionDate="2025-08-01")

    sample = session.scalars(select(Sample)).one()
    assert (sample.admin_unit_code, sample.region_code, sample.geo_status) == ("vn34:ha-noi", None, "province")


def test_every_problem_of_a_submission_is_reported_together(session, client, lab):
    response = submit(client, displayName="", collectionDate="2099-01-01", unitCode="nowhere", fasta="x")

    assert sorted(codes(response)) == [
        ("collectionDate", "DATE_IN_FUTURE"),
        ("displayName", "INVALID_NAME"),
        ("fasta", "NOT_FASTA"),
        ("unitCode", "UNKNOWN_UNIT"),
    ]
    assert counts(session) == (0, 0, 0)


def test_the_refusal_does_not_copy_the_file_back(client, lab):
    response = submit(client, fasta=">mau\n" + GENOME[:5000] + "!" + GENOME[5000:])

    assert GENOME[:60] not in response.text


def test_a_field_missing_from_the_request_is_a_validation_error_too(session, client, lab):
    body = payload()
    del body["fasta"]

    response = client.post("/api/submissions", json=body, headers=BROWSER)

    assert (response.status_code, response.json()["error"]["code"]) == (422, "VALIDATION_ERROR")
    assert counts(session) == (0, 0, 0)


def test_a_request_body_over_the_limit_is_refused_before_it_is_read(session, client, lab):
    from app.main import MAX_BODY_BYTES

    headers = BROWSER | {"Content-Type": "application/json"}
    too_big = client.post("/api/submissions", content=b" " * (MAX_BODY_BYTES + 1), headers=headers)
    at_the_limit = client.post("/api/submissions", content=b" " * MAX_BODY_BYTES, headers=headers)

    assert (too_big.status_code, too_big.json()["error"]["code"]) == (413, "BODY_TOO_LARGE")
    # Đúng bằng trần thì được đọc, và bị từ chối vì lý do khác: nó không phải JSON.
    assert at_the_limit.status_code == 422
    assert counts(session) == (0, 0, 0)


def test_a_body_sent_in_chunks_without_a_length_is_refused(client, lab):
    def chunks():
        yield b'{"displayName": "x"}'

    response = client.post("/api/submissions", content=chunks(), headers=BROWSER | {"Content-Type": "application/json"})

    assert (response.status_code, response.json()["error"]["code"]) == (411, "LENGTH_REQUIRED")


def test_one_lab_cannot_fill_the_queue(session, client, lab, monkeypatch):
    monkeypatch.setattr(service, "MAX_PENDING", 2)
    assert submit(client).status_code == 201
    assert submit(client).status_code == 201

    refused = submit(client)

    assert (refused.status_code, refused.json()["error"]["code"]) == (429, "TOO_MANY_PENDING")
    assert counts(session) == (2, 2, 2)
    # Mẫu đã có kết luận không còn tính là đang chờ.
    session.scalars(select(Sample)).first().status = "accepted"
    session.flush()
    assert submit(client).status_code == 201


def test_answers_about_submissions_are_not_to_be_stored(client, lab):
    created = submit(client)
    listing = client.get("/api/submissions")
    one = client.get(f"/api/submissions/{created.json()['internalId']}")

    assert [response.headers.get("cache-control") for response in (created, listing, one)] == ["no-store"] * 3


# --- Xem mẫu của mình ---


def test_a_lab_sees_its_own_submissions_newest_first_and_nobody_elses(session, client, lab):
    first = submit(client, displayName="mẫu thứ nhất").json()["internalId"]
    second = submit(client, displayName="mẫu thứ hai").json()["internalId"]
    make_user(session, "other@example.org")
    make_user(session, "boss@example.org", role="admin")

    mine = client.get("/api/submissions").json()
    assert [item["internalId"] for item in mine["items"]] == [second, first]
    assert (mine["total"], mine["items"][0]["submitterName"]) == (2, lab.display_name)
    assert client.get(f"/api/submissions/{first}").json()["displayName"] == "mẫu thứ nhất"

    # Người nộp khác: không thấy trong danh sách, không mở được, không xin được danh sách của mọi người.
    log_in(client, "other@example.org")
    assert client.get("/api/submissions").json() == {"items": [], "total": 0, "limit": 50, "offset": 0}
    assert client.get(f"/api/submissions/{first}").status_code == 404
    assert client.get("/api/submissions?scope=all").status_code == 403

    # Admin: danh sách riêng vẫn là của mình, nhưng mở được mọi mẫu và xin được danh sách chung.
    log_in(client, "boss@example.org")
    assert client.get("/api/submissions").json()["total"] == 0
    assert client.get(f"/api/submissions/{first}").status_code == 200
    everyone = client.get("/api/submissions?scope=all").json()
    assert [item["internalId"] for item in everyone["items"]] == [second, first]


def test_the_list_of_submissions_is_paged(client, lab):
    ids = [submit(client, displayName=f"mẫu {number}").json()["internalId"] for number in range(3)]

    page = client.get("/api/submissions?limit=2&offset=1").json()

    assert [item["internalId"] for item in page["items"]] == [ids[1], ids[0]]
    assert (page["total"], page["limit"], page["offset"]) == (3, 2, 1)


@pytest.mark.parametrize("internal_id", ["S9999999", "nothing", "S0000001%00", "S00000011111111111111111111"])
def test_a_submission_that_does_not_exist_is_not_found(client, lab, internal_id):
    response = client.get(f"/api/submissions/{internal_id}")

    assert (response.status_code, response.json()["error"]["code"]) == (404, "SUBMISSION_NOT_FOUND")


def test_a_genbank_sample_is_not_somebodys_submission(session, client, lab):
    imported = add_sample(session)

    assert client.get(f"/api/submissions/{imported.internal_id}").status_code == 404


# --- Tình trạng của một mẫu đã nộp ---


@pytest.fixture
def data_dir(tmp_path, monkeypatch) -> Path:
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    return tmp_path


def make_dataset(session, slug: str = "dengue-denv1", lineage: str = "denv1") -> DatasetDef:
    dataset = DatasetDef(slug=slug, title=f"Dengue {lineage}", pathogen="dengue", lineage=lineage, max_samples=2000)
    session.add(dataset)
    session.flush()
    return dataset


def published(session, dataset: DatasetDef, data_dir: Path, samples: list[Sample]):
    build = make_build(session, dataset, samples, data_dir / "builds", data_dir)
    publish_build(session, build)
    return build


def dated_sample(session, **fields) -> Sample:
    day = {"date_min": dt.date(2019, 3, 15), "date_max": dt.date(2019, 3, 15)}
    return add_sample(session, **(day | fields))


def submitted(session, client) -> Sample:
    internal_id = submit(client).json()["internalId"]
    return session.scalars(select(Sample).where(Sample.internal_id == internal_id)).one()


def aligned(session, sample: Sample, lineage: str = "denv1") -> None:
    session.add(
        SampleAlignment(
            sample_id=sample.id,
            lineage=lineage,
            status="aligned",
            aligned_sequence="ACGT",
            valid_nt=10_500,
            coverage=0.98,
            sequence_sha256="0" * 64,
            tool="nextclade 3.24.0",
        )
    )
    sample.status = "accepted"
    session.flush()


def place(session, sample: Sample, build, **fields) -> None:
    values = {
        "parent_node": "NODE_0000000",
        "attach_div": 0.01,
        "div": 0.02,
        "private_mutations": 3,
        "clade": "DENV1/I",
    }
    session.add(SamplePlacement(sample_id=sample.id, build_id=build.id, **(values | fields)))
    session.flush()


def stage_of(client, sample: Sample) -> str:
    return client.get(f"/api/submissions/{sample.internal_id}").json()["stage"]


def test_a_sample_whose_check_broke_down_is_reported_as_failed_not_as_still_processing(session, client, lab):
    sample = submitted(session, client)
    assert stage_of(client, sample) == "processing"

    job = session.scalars(select(Job)).one()
    job.status = "running"
    session.flush()
    assert stage_of(client, sample) == "processing"

    job.status = "failed"
    session.flush()
    assert stage_of(client, sample) == "failed"

    # Job đã bị xoá khỏi hàng đợi mà mẫu vẫn chưa có kết luận: cũng là hỏng.
    session.delete(job)
    session.flush()
    session.expire_all()
    assert stage_of(client, sample) == "failed"


def test_a_rejected_sample_says_why(session, client, lab):
    sample = submitted(session, client)
    sample.status = "rejected"
    submission = session.get(Submission, sample.id)
    submission.reject_code, submission.reject_message = "NOT_THIS_PATHOGEN", "No dengue reference is close enough"
    session.flush()

    body = client.get(f"/api/submissions/{sample.internal_id}").json()

    assert (body["status"], body["stage"]) == ("rejected", "rejected")
    assert (body["rejectCode"], body["rejectMessage"]) == ("NOT_THIS_PATHOGEN", "No dengue reference is close enough")
    assert body["lineage"] is None


def test_an_accepted_sample_moves_from_waiting_to_provisional_tip_to_the_tree(session, client, lab, data_dir):
    sample = submitted(session, client)
    aligned(session, sample)
    dataset = make_dataset(session)

    # Đạt kiểm tra, nhưng dataset của serotype này chưa có build nào để đặt lên.
    body = client.get(f"/api/submissions/{sample.internal_id}").json()
    assert (body["stage"], body["lineage"], body["validNt"], body["coverage"]) == ("accepted", "denv1", 10_500, 0.98)

    # Có build hiện hành và mẫu đã được gắn tạm vào cây của nó.
    old_build = published(session, dataset, data_dir, [dated_sample(session), dated_sample(session)])
    place(session, sample, old_build)
    body = client.get(f"/api/submissions/{sample.internal_id}").json()
    assert body["stage"] == "placed"
    assert body["placements"] == [
        {"dataset": "dengue-denv1", "title": "Dengue denv1", "clade": "DENV1/I", "privateMutations": 3}
    ]
    assert body["inDatasets"] == []

    # Build mới hơn không có mẫu này: chỗ đặt trên build cũ không còn nghĩa, mẫu lại chờ.
    newer = published(session, dataset, data_dir, [dated_sample(session), dated_sample(session)])
    assert stage_of(client, sample) == "accepted"

    # Build kế tiếp có mẫu: nó là một tip chính thức.
    session.add(BuildSample(build_id=newer.id, sample_id=sample.id, role="home"))
    session.flush()
    body = client.get(f"/api/submissions/{sample.internal_id}").json()
    assert (body["stage"], body["placements"]) == ("in_tree", [])
    assert body["inDatasets"] == [{"dataset": "dengue-denv1", "title": "Dengue denv1"}]


def test_a_hidden_sample_is_reported_as_hidden_to_its_lab(session, client, lab):
    sample = submitted(session, client)
    aligned(session, sample)
    sample.status = "hidden"
    session.flush()

    assert stage_of(client, sample) == "hidden"


# --- Tip tạm của một dataset ---


def test_the_provisional_tips_of_a_dataset_are_public_and_carry_what_the_viewer_draws(session, client, lab, data_dir):
    dataset = make_dataset(session)
    build = published(session, dataset, data_dir, [dated_sample(session), dated_sample(session)])
    sample = submitted(session, client)
    aligned(session, sample)
    place(session, sample, build, parent_node="NODE_0000000", branch_node=None, attach_div=0.0, div=0.004)
    client.post("/api/auth/logout", headers=BROWSER)

    response = client.get("/api/datasets/dengue-denv1/placements")

    assert response.status_code == 200
    body = response.json()
    assert body["buildId"] == build.id
    (tip,) = body["items"]
    placed_at = tip.pop("placedAt")
    assert dt.datetime.fromisoformat(placed_at).tzinfo is not None
    assert tip == {
        "internalId": sample.internal_id,
        "displayName": "Hà_Nội/01/2024",
        "collectionDate": "2024-01-15",
        "dateMin": "2024-01-15",
        "dateMax": "2024-01-15",
        "unitCode": "vn63:ha-noi",
        "host": "Homo sapiens",
        "parentNode": "NODE_0000000",
        "branchNode": None,
        "attachDiv": 0.0,
        "div": 0.004,
        "privateMutations": 3,
        "clade": "DENV1/I",
    }


def test_only_accepted_samples_outside_the_current_build_are_provisional_tips(session, client, lab, data_dir):
    dataset = make_dataset(session)
    member = dated_sample(session)
    old_build = published(session, dataset, data_dir, [dated_sample(session), dated_sample(session)])
    build = published(session, dataset, data_dir, [member, dated_sample(session)])

    def placed(on, status: str = "accepted") -> Sample:
        sample = submitted(session, client)
        aligned(session, sample)
        sample.status = status
        place(session, sample, on)
        return sample

    shown = placed(build)
    placed(build, status="hidden")
    placed(build, status="rejected")
    placed(old_build)  # chỉ có chỗ đặt trên build cũ
    place(session, member, build)  # đã là tip chính thức của build này

    items = client.get("/api/datasets/dengue-denv1/placements").json()["items"]

    assert [item["internalId"] for item in items] == [shown.internal_id]


def test_a_dataset_without_a_build_has_no_provisional_tips_and_an_unknown_one_is_not_found(session, client):
    make_dataset(session)

    assert client.get("/api/datasets/dengue-denv1/placements").json() == {"buildId": None, "items": []}
    missing = client.get("/api/datasets/no-such-dataset/placements")
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "DATASET_NOT_FOUND")


# --- Admin ẩn mẫu ---


def test_only_an_admin_can_hide_a_sample(session, client, lab):
    sample = submitted(session, client)
    aligned(session, sample)
    path = f"/api/admin/samples/{sample.internal_id}/hide"

    assert client.post(path, headers=BROWSER).status_code == 403
    client.post("/api/auth/logout", headers=BROWSER)
    assert client.post(path, headers=BROWSER).status_code == 401
    session.refresh(sample)
    assert sample.status == "accepted"


def test_hiding_takes_a_sample_out_of_public_view_and_unhiding_brings_it_back(session, client, lab, data_dir):
    dataset = make_dataset(session)
    build = published(session, dataset, data_dir, [dated_sample(session), dated_sample(session)])
    sample = submitted(session, client)
    aligned(session, sample)
    place(session, sample, build)
    admin = make_user(session, "boss@example.org", role="admin")
    log_in(client, admin.email)
    public = (f"/api/samples/{sample.internal_id}", "/api/datasets/dengue-denv1/placements")

    assert client.post(f"/api/admin/samples/{sample.internal_id}/hide", headers=BROWSER).status_code == 204

    assert client.get(public[0]).status_code == 404
    assert client.get(public[1]).json()["items"] == []
    # Ẩn lần nữa là sai trạng thái, không phải thành công lặng lẽ.
    again = client.post(f"/api/admin/samples/{sample.internal_id}/hide", headers=BROWSER)
    assert (again.status_code, again.json()["error"]["code"]) == (409, "INVALID_STATE")

    assert client.post(f"/api/admin/samples/{sample.internal_id}/unhide", headers=BROWSER).status_code == 204

    assert client.get(public[0]).status_code == 200
    assert len(client.get(public[1]).json()["items"]) == 1
    logged = session.execute(
        select(AuditLog.action, AuditLog.actor_id, AuditLog.subject)
        .where(AuditLog.action.like("sample_%hidden"))
        .order_by(AuditLog.id)
    ).all()
    assert [tuple(row) for row in logged] == [
        ("sample_hidden", admin.id, f"sample:{sample.internal_id}"),
        ("sample_unhidden", admin.id, f"sample:{sample.internal_id}"),
    ]


def test_a_sample_still_being_checked_or_rejected_cannot_be_made_public_by_unhiding(session, client, lab):
    sample = submitted(session, client)
    make_user(session, "boss@example.org", role="admin")
    log_in(client, "boss@example.org")

    for status in ("received", "rejected"):
        sample.status = status
        session.flush()
        for action in ("hide", "unhide"):
            response = client.post(f"/api/admin/samples/{sample.internal_id}/{action}", headers=BROWSER)
            assert (response.status_code, response.json()["error"]["code"]) == (409, "INVALID_STATE")
    missing = client.post("/api/admin/samples/S9999999/hide", headers=BROWSER)
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "SAMPLE_NOT_FOUND")


# --- Danh mục đơn vị hành chính ---


def test_the_units_list_gives_the_form_both_province_sets_with_their_dates(client):
    everything = client.get("/api/units").json()["items"]
    provinces = client.get("/api/units?level=province").json()["items"]

    assert len(everything) == 3 + 6 + 63 + 34
    assert [len([unit for unit in provinces if unit["unitSet"] == name]) for name in ("vn63", "vn34")] == [63, 34]
    by_code = {unit["code"]: unit for unit in provinces}
    assert by_code["vn63:ha-noi"] == {
        "code": "vn63:ha-noi",
        "level": "province",
        "unitSet": "vn63",
        "nameVi": "Hà Nội",
        "nameEn": "Ha Noi",
        "parentCode": "vnr:red-river-delta",
        "successorCode": "vn34:ha-noi",
        "validFrom": None,
        "validTo": "2025-06-30",
    }
    assert (by_code["vn34:ha-noi"]["validFrom"], by_code["vn34:ha-noi"]["validTo"]) == ("2025-07-01", None)
    assert client.get("/api/units?level=planet").status_code == 422
