import datetime as dt
import hashlib
import itertools
import json
import unicodedata
from pathlib import Path

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.orm import object_session

from app.accounts import passwords
from app.accounts import service as accounts
from app.build.pipeline import republish_build
from app.build.publish import publish_build
from app.build.selection import inputs_hash, select_samples
from app.config import settings
from app.geo.seed import seed_geo
from app.jobs import queue
from app.jobs.steps import JobContext
from app.models import (
    AdminUnit,
    AuditLog,
    BuildSample,
    DatasetDef,
    Job,
    JobStep,
    Sample,
    SampleAlignment,
    SamplePlacement,
    SampleSequence,
    Submission,
)
from app.submissions import placement, service
from app.submissions.ingest import ingest_sample
from app.submissions.validate import MAX_FASTA_CHARS
from tests.support import add_sample, make_build

PASSWORD = "mật khẩu đủ dài"
BROWSER = {"X-Requested-With": "vietstrain"}
GENOME = "ACGT" * 2650  # 10.600 nucleotide: nằm trong khoảng độ dài của một genome dengue
_variants = itertools.count(1)


def fresh_genome() -> str:
    """Một genome chưa ai nộp: 12 vị trí đầu ghi một số đếm bằng bốn chữ A, C, G, T.

    Hai lần nộp cùng một chuỗi bị hỏi lại (409), nên các test không thử điều đó dùng mỗi lần một chuỗi riêng.
    """
    number = next(_variants)
    head = "".join("ACGT"[(number >> (2 * place)) & 3] for place in range(12))
    return head + GENOME[12:]


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
        "fasta": f">ten trong file\n{fresh_genome()}\n",
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
    # Một job dựng cây đã chờ sẵn trong hàng đợi từ trước khi mẫu được nộp.
    build_job = queue.enqueue(session, "build_dataset", {"dataset": "dengue-denv1"})

    response = submit(client, fasta=f">ten trong file\n{GENOME}\n")

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

    # Lần nộp ghi người nộp và job kiểm tra; job này vượt lên trước job dựng cây đã chờ sẵn.
    submission = session.scalars(select(Submission)).one()
    job = session.scalars(select(Job).where(Job.kind == "ingest_sample")).one()
    assert (submission.sample_id, submission.submitter_id, submission.job_id) == (sample.id, lab.id, job.id)
    assert (job.kind, job.params, job.status) == ("ingest_sample", {"sample_id": sample.id}, "queued")
    assert build_job.id < job.id
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


def test_the_sample_name_is_stored_trimmed_and_in_one_unicode_form(session, client, lab):
    composed = unicodedata.normalize("NFC", "Hà_Nội/01/2024")
    typed = "  " + unicodedata.normalize("NFD", composed) + " "
    assert typed.strip() != composed

    body = submit(client, displayName=typed).json()

    assert body["displayName"] == composed
    assert session.scalars(select(Sample.display_name)).one() == composed


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
    # Mẫu mà job kiểm tra đã chạy xong không còn tính là đang chờ.
    session.scalars(select(Job).order_by(Job.id)).first().status = "succeeded"
    session.flush()
    assert submit(client).status_code == 201


def test_another_labs_waiting_samples_do_not_count_against_me(session, client, lab, monkeypatch):
    monkeypatch.setattr(service, "MAX_PENDING", 1)
    assert submit(client).status_code == 201
    make_user(session, "other@example.org")
    log_in(client, "other@example.org")

    assert submit(client).status_code == 201


def test_a_sample_whose_check_broke_down_does_not_hold_a_place_in_the_queue(session, client, lab, monkeypatch):
    # Job hỏng không tự chạy lại, và mẫu của nó ở lại trạng thái `received`. Nếu các mẫu đó vẫn bị tính là đang
    # chờ thì sau vài sự cố của worker, phòng xét nghiệm không nộp được nữa và không có cách nào tự gỡ.
    monkeypatch.setattr(service, "MAX_PENDING", 2)
    assert submit(client).status_code == 201
    assert submit(client).status_code == 201
    first, second = session.scalars(select(Job).order_by(Job.id)).all()
    first.status = "failed"
    session.flush()

    assert submit(client).status_code == 201
    assert submit(client).status_code == 429

    # Job đang chạy vẫn là đang chờ; job đã bị xoá khỏi hàng đợi thì không.
    second.status = "running"
    session.flush()
    assert submit(client).status_code == 429
    session.delete(second)
    session.flush()
    session.expire_all()
    assert submit(client).status_code == 201


def test_one_lab_cannot_submit_without_end_in_one_day(session, client, lab, monkeypatch):
    # Trần số mẫu đang chờ chỉ giữ nhịp: mẫu được kiểm tra trong khoảng một giây rồi thôi không bị tính. Trần theo
    # ngày chặn việc một tài khoản chất hàng nghìn mẫu tạm lên cây giữa hai lần build.
    monkeypatch.setattr(service, "MAX_PER_DAY", 2)
    assert submit(client).status_code == 201
    assert submit(client).status_code == 201
    session.execute(update(Sample).values(status="accepted"))

    refused = submit(client)

    assert (refused.status_code, refused.json()["error"]["code"]) == (429, "TOO_MANY_TODAY")
    assert counts(session) == (2, 2, 2)
    # Lần nộp cách đây 23 giờ vẫn được tính, cách đây 25 giờ thì không.
    oldest = session.scalars(select(Submission).order_by(Submission.sample_id)).first()
    oldest.created_at = func.now() - dt.timedelta(hours=23)
    session.flush()
    assert submit(client).status_code == 429
    oldest.created_at = func.now() - dt.timedelta(hours=25)
    session.flush()
    assert submit(client).status_code == 201
    # Trần là của từng tài khoản.
    make_user(session, "other@example.org")
    log_in(client, "other@example.org")
    assert submit(client).status_code == 201


def test_the_province_is_checked_against_the_date_even_when_the_file_is_bad(session, client, lab):
    response = submit(client, fasta="x", unitCode="vn34:ha-noi", collectionDate="2024-01-15")

    assert sorted(codes(response)) == [("fasta", "NOT_FASTA"), ("unitCode", "UNIT_NOT_VALID_ON_DATE")]


def test_a_content_length_that_is_not_a_number_is_a_bad_request(client, lab):
    headers = BROWSER | {"Content-Type": "application/json", "Content-Length": "abc"}

    response = client.post("/api/submissions", content=b"{}", headers=headers)

    assert (response.status_code, response.json()["error"]["code"]) == (400, "BAD_REQUEST")


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


# --- Chuỗi giống hệt một mẫu đã có ---


def identical(response) -> dict:
    error = response.json()["error"]
    assert (response.status_code, error["code"]) == (409, "IDENTICAL_SEQUENCE")
    return error


def with_sequence(sample: Sample, sequence: str = GENOME) -> Sample:
    sample_sequence = SampleSequence(
        sample_id=sample.id,
        sequence=sequence,
        length=len(sequence),
        sha256=hashlib.sha256(sequence.encode()).hexdigest(),
    )
    object_session(sample).add(sample_sequence)
    object_session(sample).flush()
    return sample


def submitted_by(session, user, *, name: str, status: str) -> Sample:
    sample = service.submit(
        session,
        user,
        display_name=name,
        collection_date="2024-01-15",
        unit_code="vn63:ha-noi",
        host=None,
        fasta=f">x\n{GENOME}\n",
        today=dt.date(2026, 1, 1),
    )
    sample.status = status
    session.flush()
    return sample


def submissions_logged(session) -> list[dict]:
    query = select(AuditLog.detail).where(AuditLog.action == "sample_submitted").order_by(AuditLog.id)
    return list(session.scalars(query))


def test_sending_a_sequence_again_is_stopped_with_the_sample_it_matches_and_nothing_is_stored(
    session, client, lab, monkeypatch
):
    first = submit(client, fasta=f">a\n{GENOME}\n").json()
    monkeypatch.setattr(service, "MAX_PER_DAY", 2)

    again = submit(client, displayName="Một tên khác", fasta=f">b\n{GENOME}\n")

    error = identical(again)
    assert error["matchCount"] == 1
    assert error["matches"] == [
        {
            "internalId": first["internalId"],
            "displayName": "Hà_Nội/01/2024",
            "source": "submission",
            "accession": None,
            "mine": True,
        }
    ]
    assert counts(session) == (1, 1, 1)
    assert submissions_logged(session) == [{}]
    # Lần bị hỏi lại không chiếm chỗ trong trần mỗi ngày: với trần 2, một mẫu nữa vẫn được nhận.
    assert submit(client).status_code == 201


def test_a_lab_that_says_it_is_another_sample_gets_it_taken_and_the_log_keeps_the_warning(session, client, lab):
    submit(client, fasta=f">a\n{GENOME}\n")

    taken = submit(client, fasta=f">b\n{GENOME}\n", allowIdentical=True)

    assert taken.status_code == 201
    assert taken.json()["status"] == "received"
    assert counts(session) == (2, 2, 2)
    assert submissions_logged(session) == [{}, {"identical_to": 1}]


def test_allowing_an_identical_sequence_changes_nothing_when_there_is_none(session, client, lab):
    assert submit(client, allowIdentical=True).status_code == 201
    assert submissions_logged(session) == [{}]


def test_a_sequence_already_in_genbank_is_named_by_its_accession_not_by_its_internal_id(session, client, lab):
    with_sequence(add_sample(session, display_name="DENV1/VN/2019", accession="OQ000001"))

    error = identical(submit(client, fasta=f">x\n{GENOME}\n"))

    assert error["matches"] == [
        {
            "internalId": None,
            "displayName": "DENV1/VN/2019",
            "source": "genbank",
            "accession": "OQ000001",
            "mine": False,
        }
    ]


@pytest.mark.parametrize("status", ["received", "rejected", "hidden"])
def test_a_sample_another_lab_has_not_made_public_is_never_mentioned(session, client, lab, status):
    other = make_user(session, "other@example.org")
    submitted_by(session, other, name="Mẫu chưa công khai của phòng khác", status=status)

    response = submit(client, fasta=f">y\n{GENOME}\n")

    assert response.status_code == 201
    assert "phòng khác" not in response.text


def test_a_public_sample_of_another_lab_is_named_without_its_internal_id(session, client, lab):
    other = make_user(session, "other@example.org")
    submitted_by(session, other, name="Mẫu đã công khai của phòng khác", status="accepted")

    error = identical(submit(client, fasta=f">y\n{GENOME}\n"))

    assert error["matches"] == [
        {
            "internalId": None,
            "displayName": "Mẫu đã công khai của phòng khác",
            "source": "submission",
            "accession": None,
            "mine": False,
        }
    ]


def test_my_own_sample_is_named_whatever_became_of_it(session, client, lab):
    for status in ["rejected", "hidden"]:
        mine = submitted_by(session, lab, name=f"Mẫu {status}", status=status)
        error = identical(submit(client, fasta=f">y\n{GENOME}\n"))
        assert [match["internalId"] for match in error["matches"]] == [mine.internal_id]
        session.delete(mine)
        session.flush()


def test_sequences_are_compared_as_the_check_stores_them(client, lab):
    submit(client, fasta=f">a\n{GENOME}\n")
    lines = "\r\n".join(GENOME.lower().replace("t", "u")[start : start + 60] for start in range(0, len(GENOME), 60))

    assert identical(submit(client, fasta=f">mot ten hoan toan khac\r\n{lines}\r\n"))["matchCount"] == 1
    one_letter_off = GENOME[:100] + "T" + GENOME[101:]
    assert one_letter_off != GENOME
    assert submit(client, fasta=f">b\n{one_letter_off}\n").status_code == 201


def test_at_most_five_matches_are_named_mine_first_then_newest_first(session, client, lab):
    for number in range(4):
        with_sequence(add_sample(session, display_name=f"genbank-{number}"))
    for number in range(3):
        assert (
            submit(client, displayName=f"mine-{number}", fasta=f">x\n{GENOME}\n", allowIdentical=True).status_code
            == 201
        )

    error = identical(submit(client, fasta=f">x\n{GENOME}\n"))

    assert error["matchCount"] == 7
    assert [(match["displayName"], match["mine"]) for match in error["matches"]] == [
        ("mine-2", True),
        ("mine-1", True),
        ("mine-0", True),
        ("genbank-3", False),
        ("genbank-2", False),
    ]


def test_a_bad_file_or_a_full_queue_is_reported_before_an_identical_sequence(session, client, lab, monkeypatch):
    submit(client, fasta=f">a\n{GENOME}\n")

    bad = submit(client, fasta=f">a\n{GENOME}\n", collectionDate="2999-01-01")
    assert (bad.status_code, codes(bad)) == (422, [("collectionDate", "DATE_IN_FUTURE")])

    monkeypatch.setattr(service, "MAX_PENDING", 1)
    full = submit(client, fasta=f">a\n{GENOME}\n")
    assert (full.status_code, full.json()["error"]["code"]) == (429, "TOO_MANY_PENDING")


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
    # Job kiểm tra của mẫu (nếu là mẫu nộp) đã chạy xong.
    session.execute(
        update(Job)
        .where(Job.id == select(Submission.job_id).where(Submission.sample_id == sample.id).scalar_subquery())
        .values(status="succeeded")
    )
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


def test_a_sample_that_passed_the_check_is_still_being_processed_until_its_job_has_tried_to_place_it(
    session, client, lab
):
    # Job ghi kết luận "đạt" trước, rồi mới gắn mẫu lên cây. Trong khoảng giữa đó, trang của người nộp phải tiếp tục
    # chờ: nếu báo "chưa có cây để gắn" thì nó ngừng tự cập nhật, và người nộp không bao giờ thấy mẫu lên cây.
    sample = submitted(session, client)
    job = session.scalars(select(Job)).one()
    job.status = "running"
    session.add(
        SampleAlignment(
            sample_id=sample.id,
            lineage="denv1",
            status="aligned",
            aligned_sequence="ACGT",
            valid_nt=10_500,
            sequence_sha256="0" * 64,
            tool="nextclade 3.24.0",
        )
    )
    sample.status = "accepted"
    session.flush()

    assert stage_of(client, sample) == "processing"

    job.status = "succeeded"
    session.flush()
    assert stage_of(client, sample) == "accepted"


def test_a_rejected_sample_says_why(session, client, lab):
    sample = submitted(session, client)
    sample.status = "rejected"
    submission = session.get(Submission, sample.id)
    submission.reject_code, submission.reject_message = "NOT_THIS_PATHOGEN", "No dengue reference is close enough"
    # Kết quả gióng tốt nhất vẫn được lưu để tra cứu, nhưng một lần gióng hỏng không nói mẫu thuộc serotype nào.
    session.add(
        SampleAlignment(
            sample_id=sample.id,
            lineage="denv2",
            status="failed",
            coverage=0.4,
            error="Too divergent",
            sequence_sha256="0" * 64,
            tool="nextclade 3.24.0",
        )
    )
    session.flush()

    body = client.get(f"/api/submissions/{sample.internal_id}").json()

    assert (body["status"], body["stage"]) == ("rejected", "rejected")
    assert (body["rejectCode"], body["rejectMessage"]) == ("NOT_THIS_PATHOGEN", "No dengue reference is close enough")
    assert (body["lineage"], body["coverage"], body["validNt"]) == (None, None, None)


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


def test_a_sample_that_passed_the_check_but_could_not_be_placed_says_so(session, client, lab, data_dir):
    # Job ghi kết luận "đạt" rồi hỏng ở bước gắn. "Chưa có cây để gắn" sẽ là nói sai lý do.
    sample = submitted(session, client)
    aligned(session, sample)
    job = session.scalars(select(Job)).one()
    job.status = "failed"
    session.flush()

    assert stage_of(client, sample) == "placement_failed"

    # Job bị admin huỷ giữa chừng cũng vậy: mẫu đã đạt, việc gắn chưa xong.
    job.status = "cancelled"
    session.flush()
    assert stage_of(client, sample) == "placement_failed"
    job.status = "failed"
    session.flush()

    # Job đã bị dọn khỏi hàng đợi thì không còn gì nói rằng lần gắn đã hỏng.
    session.delete(job)
    session.flush()
    session.expire_all()
    assert stage_of(client, sample) == "accepted"

    # Lần gắn lại sau build kế tiếp thành công: mẫu là một mẫu tạm như mọi mẫu khác.
    build = published(session, make_dataset(session), data_dir, [dated_sample(session), dated_sample(session)])
    place(session, sample, build)
    assert stage_of(client, sample) == "placed"


# --- Job gắn mẫu khi có mẫu không gắn được ---


def placing(session, work_dir: Path, kind: str, params: dict) -> JobContext:
    """Job `kind` vừa được worker lấy về, đứng trước mọi job kiểm tra còn chờ."""
    queue.enqueue(session, kind, params, priority=100)
    return JobContext(session=session, job=queue.claim(session, "w1"), work_dir=work_dir)


def fake_placing(monkeypatch, refuse) -> None:
    """Thay lần chạy Nextclade: ghi một chỗ gắn, trừ khi `refuse(dataset, sample)` đúng; khi đó hỏng giữa chừng."""

    def place_on_build(context, lineage, dataset, build, sample, *, name):
        if refuse(dataset, sample):
            # Hỏng sau khi đã ghi dở vào database: transaction của session không dùng tiếp được nếu không rollback.
            context.session.add(SamplePlacement(sample_id=sample.id, build_id=-1, parent_node="x", attach_div=0, div=0))
            context.session.flush()
        place(context.session, sample, build)
        return placement.Placement(parent_node="NODE_0000000", branch_node=None, attach_div=0.01, div=0.02)

    monkeypatch.setattr(placement, "place_on_build", place_on_build)


def placed_samples(session, build) -> list[int]:
    return list(
        session.scalars(
            select(SamplePlacement.sample_id).filter_by(build_id=build.id).order_by(SamplePlacement.sample_id)
        )
    )


def test_one_sample_that_cannot_be_placed_does_not_stop_the_ones_after_it(
    session, client, lab, data_dir, tmp_path, monkeypatch
):
    dataset = make_dataset(session)
    build = published(session, dataset, data_dir, [dated_sample(session), dated_sample(session)])
    samples = [submitted(session, client) for _ in range(3)]
    for sample in samples:
        aligned(session, sample)
    broken = samples[1]
    fake_placing(monkeypatch, lambda dataset, sample: sample.id == broken.id)

    with pytest.raises(placement.PlacementFailed) as error:
        placement.place_pending(placing(session, tmp_path / "1", "place_pending", {"dataset": "dengue-denv1"}))

    # Job vẫn kết thúc là hỏng, để người vận hành thấy; lỗi nói mẫu nào và vì sao.
    assert "1 of 3" in str(error.value) and broken.internal_id in str(error.value)
    assert "IntegrityError" in str(error.value)
    assert placed_samples(session, build) == [samples[0].id, samples[2].id]

    # Lần chạy sau chỉ còn phải gắn mẫu đã hỏng.
    fake_placing(monkeypatch, lambda dataset, sample: False)
    again = placement.place_pending(placing(session, tmp_path / "2", "place_pending", {"dataset": "dengue-denv1"}))
    assert (again["placed"], again["unplaced"]) == (1, 0)
    assert placed_samples(session, build) == [sample.id for sample in samples]


def test_a_tool_that_breaks_on_every_sample_fails_the_job_after_trying_them_all(
    session, client, lab, data_dir, tmp_path
):
    # Lần này là lần gắn thật, với công cụ không chạy được: mỗi mẫu để lại một bước hỏng có ghi lý do.
    published(session, make_dataset(session), data_dir, [dated_sample(session), dated_sample(session)])
    for _ in range(2):
        aligned(session, submitted(session, client))
    context = placing(session, tmp_path, "place_pending", {"dataset": "dengue-denv1"})
    context.allowed_tools = frozenset()

    with pytest.raises(placement.PlacementFailed, match="2 of 2 placements failed"):
        placement.place_pending(context)

    steps = session.execute(
        select(JobStep.name, JobStep.status, JobStep.log_tail)
        .filter_by(job_id=context.job.id)
        .order_by(JobStep.position)
    ).all()
    assert [(name, status) for name, status, _ in steps] == [("place-0001", "failed"), ("place-0002", "failed")]
    assert all("ToolNotAllowed" in log_tail for _, _, log_tail in steps)
    assert session.scalar(select(func.count()).select_from(SamplePlacement)) == 0


def test_a_tree_that_cannot_take_a_new_sample_does_not_stop_the_other_trees(
    session, client, lab, data_dir, tmp_path, monkeypatch
):
    builds = {
        slug: published(session, make_dataset(session, slug), data_dir, [dated_sample(session), dated_sample(session)])
        for slug in ("dengue-denv1-a", "dengue-denv1-b")
    }
    sample = submitted(session, client)
    aligned(session, sample)
    session.execute(update(Job).values(status="queued"))  # job kiểm tra của mẫu được chạy lại
    fake_placing(monkeypatch, lambda dataset, sample: dataset.slug == "dengue-denv1-a")
    context = JobContext(session=session, job=queue.claim(session, "w1"), work_dir=tmp_path)

    with pytest.raises(placement.PlacementFailed) as error:
        ingest_sample(context)

    assert "dengue-denv1-a" in str(error.value) and "dengue-denv1-b" not in str(error.value)
    assert placed_samples(session, builds["dengue-denv1-a"]) == []
    assert placed_samples(session, builds["dengue-denv1-b"]) == [sample.id]
    # Worker ghi job là hỏng. Mẫu đã có một chỗ gắn nên người nộp thấy nó là mẫu tạm.
    assert queue.fail(session, context.job, str(error.value))
    assert stage_of(client, sample) == "placed"


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
        "parentIndex": 0,
        "branchNode": None,
        "branchIndex": None,
        "attachDiv": 0.0,
        "div": 0.004,
        "privateMutations": 3,
        "clade": "DENV1/I",
    }


def test_a_provisional_tip_points_at_its_nodes_by_their_place_in_the_published_tree(session, client, lab, data_dir):
    # Viewer giữ cây dưới dạng mảng số, không giữ tên node trong: API đổi tên node thành chỉ số trong tree.json
    # của đúng bản publish đang được phát.
    dataset = make_dataset(session)
    members = [dated_sample(session), dated_sample(session), dated_sample(session)]
    build = published(session, dataset, data_dir, members)
    tree = json.loads((data_dir / "builds" / build.path / "tree.json").read_text())
    on_a_tip = submitted(session, client)
    aligned(session, on_a_tip)
    place(session, on_a_tip, build, parent_node="NODE_0000000", branch_node=members[2].internal_id)
    lost = submitted(session, client)
    aligned(session, lost)
    place(session, lost, build, parent_node="no-such-node")

    items = client.get("/api/datasets/dengue-denv1/placements").json()["items"]

    # Chỗ đặt trỏ tới node mà bản publish không có thì không được trả về: viewer không vẽ được nó.
    (tip,) = items
    assert tip["internalId"] == on_a_tip.internal_id
    assert (tree["name"][tip["parentIndex"]], tree["name"][tip["branchIndex"]]) == (
        "NODE_0000000",
        members[2].internal_id,
    )


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


# --- Sửa mẫu đã nộp ---


def correct(client, sample: Sample, **changes):
    """Gửi một lần sửa; không nói gì thêm thì gửi lại đúng các giá trị của lúc nộp."""
    body = {key: value for key, value in payload(**changes).items() if key != "fasta"}
    return client.patch(f"/api/submissions/{sample.internal_id}", json=body, headers=BROWSER)


def accepted(session, client, **changes) -> Sample:
    internal_id = submit(client, **changes).json()["internalId"]
    sample = session.scalars(select(Sample).where(Sample.internal_id == internal_id)).one()
    aligned(session, sample)
    return sample


def stored(session, sample: Sample) -> tuple:
    session.expire_all()
    return (
        sample.display_name,
        sample.collection_date_raw,
        sample.date_min,
        sample.date_max,
        sample.division_raw,
        sample.admin_unit_code,
        sample.region_code,
        sample.host,
        sample.status,
    )


def audit_rows(session) -> list[tuple[str, str | None, dict]]:
    return [(row.action, row.subject, row.detail) for row in session.scalars(select(AuditLog).order_by(AuditLog.id))]


def test_a_lab_corrects_the_name_date_province_and_host_of_its_sample(session, client, lab):
    sample = accepted(session, client)
    sequence = session.scalar(select(SampleSequence.sha256).where(SampleSequence.sample_id == sample.id))
    internal_id = sample.internal_id

    response = correct(
        client,
        sample,
        displayName="  Đà Nẵng/02/2023 ",
        collectionDate="2023-02",
        unitCode="vn63:da-nang",
        host="Aedes aegypti",
    )

    body = response.json()
    assert response.status_code == 200
    assert (body["internalId"], body["displayName"], body["collectionDate"], body["unitCode"], body["host"]) == (
        internal_id,
        "Đà Nẵng/02/2023",
        "2023-02-XX",
        "vn63:da-nang",
        "Aedes aegypti",
    )
    da_nang = session.get(AdminUnit, "vn63:da-nang")
    assert stored(session, sample) == (
        "Đà Nẵng/02/2023",
        "2023-02-XX",
        dt.date(2023, 2, 1),
        dt.date(2023, 2, 28),
        da_nang.name_vi,
        "vn63:da-nang",
        da_nang.parent_code,
        "Aedes aegypti",
        "accepted",
    )
    # Chuỗi không đổi, và không có việc kiểm tra mới nào được xếp.
    assert session.scalar(select(SampleSequence.sha256).where(SampleSequence.sample_id == sample.id)) == sequence
    assert session.scalar(select(func.count()).select_from(Job)) == 1
    assert audit_rows(session)[-1] == (
        "sample_edited",
        f"sample:{internal_id}",
        {"fields": ["collectionDate", "displayName", "host", "unitCode"]},
    )


def test_a_correction_names_only_the_fields_that_changed(session, client, lab):
    sample = accepted(session, client)

    assert correct(client, sample, host=None).status_code == 200

    assert stored(session, sample)[7] is None
    assert audit_rows(session)[-1][2] == {"fields": ["host"]}


def test_sending_back_the_values_a_sample_already_has_leaves_no_trace(session, client, lab, data_dir):
    sample = accepted(session, client)
    published(session, make_dataset(session), data_dir, [sample])
    before = (stored(session, sample), len(audit_rows(session)), session.scalar(select(func.count()).select_from(Job)))

    # Khoảng trắng hai đầu của tên bị bỏ như lúc nộp, nên đây vẫn là cùng một tên.
    response = correct(client, sample, displayName="  Hà_Nội/01/2024  ")

    assert response.status_code == 200
    after = (stored(session, sample), len(audit_rows(session)), session.scalar(select(func.count()).select_from(Job)))
    assert after == before


def test_only_the_lab_that_submitted_a_sample_can_correct_it(session, client, lab):
    sample = accepted(session, client)
    before = stored(session, sample)
    make_user(session, "other@example.org")
    make_user(session, "boss@example.org", role="admin")

    without_header = client.patch(f"/api/submissions/{sample.internal_id}", json=payload(displayName="của tôi"))
    assert (without_header.status_code, without_header.json()["error"]["code"]) == (403, "CSRF_HEADER_REQUIRED")

    log_in(client, "other@example.org")
    stranger = correct(client, sample, displayName="của tôi")
    assert (stranger.status_code, stranger.json()["error"]["code"]) == (404, "SUBMISSION_NOT_FOUND")

    # Admin xem được mọi mẫu, nhưng dữ liệu của một phòng xét nghiệm là do phòng đó khai.
    log_in(client, "boss@example.org")
    admin = correct(client, sample, displayName="của tôi")
    assert (admin.status_code, admin.json()["error"]["code"]) == (403, "FORBIDDEN")

    client.cookies.clear()
    guest = correct(client, sample, displayName="của tôi")
    assert (guest.status_code, guest.json()["error"]["code"]) == (401, "NOT_AUTHENTICATED")

    assert stored(session, sample) == before
    assert "sample_edited" not in [action for action, _, _ in audit_rows(session)]


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"displayName": "   "}, [("displayName", "INVALID_NAME")]),
        ({"displayName": "hai\ndòng"}, [("displayName", "INVALID_NAME")]),
        ({"collectionDate": "15/01/2024"}, [("collectionDate", "INVALID_DATE")]),
        ({"collectionDate": "2099-01-01"}, [("collectionDate", "DATE_IN_FUTURE")]),
        ({"host": "Homo\nsapiens"}, [("host", "INVALID_HOST")]),
        ({"unitCode": "vn63:atlantis"}, [("unitCode", "UNKNOWN_UNIT")]),
        ({"unitCode": "vnr:red-river-delta"}, [("unitCode", "UNKNOWN_UNIT")]),
        ({"unitCode": "'; DROP TABLE sample; --"}, [("unitCode", "UNKNOWN_UNIT")]),
        # Ngày mới đưa mẫu sang bên kia ngày sáp nhập: tỉnh đang chọn không còn tồn tại vào ngày đó.
        ({"collectionDate": "2025-07-01"}, [("unitCode", "UNIT_NOT_VALID_ON_DATE")]),
        ({"unitCode": "vn34:ha-noi"}, [("unitCode", "UNIT_NOT_VALID_ON_DATE")]),
        (
            {"displayName": "", "collectionDate": "hôm qua", "unitCode": "vn63:atlantis", "host": "a\tb"},
            [
                ("displayName", "INVALID_NAME"),
                ("collectionDate", "INVALID_DATE"),
                ("host", "INVALID_HOST"),
                ("unitCode", "UNKNOWN_UNIT"),
            ],
        ),
    ],
)
def test_a_correction_that_is_wrong_is_refused_with_the_reason_and_nothing_changes(
    session, client, lab, changes, expected
):
    sample = accepted(session, client)
    before = (stored(session, sample), len(audit_rows(session)))

    response = correct(client, sample, **changes)

    assert (response.status_code, response.json()["error"]["code"]) == (422, "VALIDATION_ERROR")
    assert codes(response) == expected
    assert (stored(session, sample), len(audit_rows(session))) == before


def test_a_correction_must_carry_all_four_fields(session, client, lab):
    sample = accepted(session, client)

    response = client.patch(
        f"/api/submissions/{sample.internal_id}", json={"displayName": "chỉ có tên"}, headers=BROWSER
    )

    assert (response.status_code, response.json()["error"]["code"]) == (422, "VALIDATION_ERROR")
    assert stored(session, sample)[0] == "Hà_Nội/01/2024"


@pytest.mark.parametrize(
    ("state", "code"),
    [
        ("waiting for its check", "SAMPLE_BEING_CHECKED"),
        ("accepted, still being placed", "SAMPLE_BEING_CHECKED"),
        ("check broke down", "SAMPLE_NOT_EDITABLE"),
        ("rejected", "SAMPLE_NOT_EDITABLE"),
        ("hidden", "SAMPLE_NOT_EDITABLE"),
    ],
)
def test_a_sample_that_is_not_settled_as_accepted_cannot_be_corrected(session, client, lab, state, code):
    sample = submitted(session, client)
    job = session.get(Job, session.scalar(select(Submission.job_id).where(Submission.sample_id == sample.id)))
    if state == "accepted, still being placed":
        aligned(session, sample)
        job.status = "running"
    elif state == "check broke down":
        job.status = "failed"
    elif state == "rejected":
        job.status, sample.status = "succeeded", "rejected"
    elif state == "hidden":
        aligned(session, sample)
        sample.status = "hidden"
    session.flush()
    before = stored(session, sample)

    response = correct(client, sample, displayName="tên khác")

    assert (response.status_code, response.json()["error"]["code"]) == (409, code)
    assert stored(session, sample) == before


@pytest.mark.parametrize("internal_id", ["S9999999", "nothing", "S0000001%00"])
def test_correcting_a_submission_that_does_not_exist_is_not_found(client, lab, internal_id):
    body = {key: value for key, value in payload().items() if key != "fasta"}

    response = client.patch(f"/api/submissions/{internal_id}", json=body, headers=BROWSER)

    assert (response.status_code, response.json()["error"]["code"]) == (404, "SUBMISSION_NOT_FOUND")


def test_a_genbank_record_cannot_be_corrected_as_if_it_were_a_submission(session, client, lab):
    record = dated_sample(session, accession="OQ000001", display_name="bản ghi GenBank")

    response = correct(client, record, displayName="của tôi")

    assert response.status_code == 404
    session.expire_all()
    assert record.display_name == "bản ghi GenBank"


def test_a_provisional_tip_shows_the_corrected_values_at_once(session, client, lab, data_dir):
    other = dated_sample(session)
    dataset = make_dataset(session)
    build = published(session, dataset, data_dir, [other])
    sample = accepted(session, client)
    place(session, sample, build)

    correct(client, sample, displayName="Tên đã sửa", collectionDate="2023-05", unitCode="vn63:da-nang")

    (tip,) = client.get(f"/api/datasets/{dataset.slug}/placements").json()["items"]
    assert (tip["displayName"], tip["collectionDate"], tip["dateMin"], tip["dateMax"], tip["unitCode"]) == (
        "Tên đã sửa",
        "2023-05-XX",
        "2023-05-01",
        "2023-05-31",
        "vn63:da-nang",
    )
    # Tip tạm đọc thẳng từ database: không có bản publish nào phải viết lại.
    assert session.scalar(select(func.count()).select_from(Job).where(Job.kind == "publish_build")) == 0


def test_correcting_an_official_tip_republishes_its_tree_without_rebuilding_it(
    session, client, lab, data_dir, tmp_path
):
    sample = accepted(session, client)
    other = dated_sample(session)
    dataset = make_dataset(session)
    build = published(session, dataset, data_dir, [sample, other])
    elsewhere = published(session, make_dataset(session, "dengue-denv1-north"), data_dir, [other])
    before = build.path

    response = correct(client, sample, displayName="Tên đã sửa", unitCode="vn63:da-nang")

    assert response.status_code == 200
    waiting = session.scalars(select(Job).where(Job.status == "queued").order_by(Job.id)).all()
    assert [(job.kind, job.params, job.priority) for job in waiting] == [
        ("publish_build", {"build_id": build.id}, queue.INTERACTIVE)
    ]
    assert elsewhere.path is not None  # cây không có mẫu này thì không bị đụng tới

    republish_build(JobContext(session=session, job=queue.claim(session, "w1"), work_dir=tmp_path))

    session.expire_all()
    old, new = data_dir / "builds" / before, data_dir / "builds" / build.path
    assert build.path != before and build.is_current
    assert (new / "tree.json").read_bytes() == (old / "tree.json").read_bytes()
    assert "Tên đã sửa" in json.loads((new / "tips.json").read_text(encoding="utf-8"))["displayName"]
    assert "Tên đã sửa" not in json.loads((old / "tips.json").read_text(encoding="utf-8"))["displayName"]
    assert "vn63:da-nang" in json.loads((new / "col.unit.json").read_text(encoding="utf-8"))["values"]


def test_correcting_the_date_changes_what_the_next_tree_is_built_from_but_correcting_the_name_does_not(
    session, client, lab
):
    sample = accepted(session, client)
    dataset = make_dataset(session)

    def tree_inputs() -> str:
        session.expire_all()
        choices = select_samples(session, dataset)
        assert sample.id in {choice.sample_id for choice in choices}
        return inputs_hash(session, choices)

    before = tree_inputs()

    correct(client, sample, displayName="Tên đã sửa", host=None)
    assert tree_inputs() == before

    correct(client, sample, displayName="Tên đã sửa", host=None, collectionDate="2024-01-16")
    assert tree_inputs() != before
