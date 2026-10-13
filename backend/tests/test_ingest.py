import datetime as dt
import json
import random
from pathlib import Path

import pytest
from sqlalchemy import delete, func, select

from app.accounts import passwords
from app.accounts import service as accounts
from app.config import settings
from app.geo.seed import seed_geo
from app.jobs import queue
from app.jobs.handlers import HANDLERS, build_then_place
from app.jobs.steps import JobContext
from app.models import (
    Build,
    BuildSample,
    DatasetDef,
    Job,
    JobStep,
    Sample,
    SampleAlignment,
    SamplePlacement,
    Submission,
)
from app.pathogens import DENGUE
from app.samples.importer import import_genbank, read_fasta
from app.submissions import service
from app.submissions.ingest import ingest_sample
from app.submissions.placement import node_names, place_pending
from tests.support import add_sample

FIXTURES = Path(__file__).parent / "fixtures"
TODAY = dt.date(2026, 10, 13)
HOSTILE_NAME = "Hà_Nội/01/2024; touch pwned"
# Một genome DENV1 gần trọn vẹn của Việt Nam (lấy mẫu ngày 2012-12-19) và genome DENV2 duy nhất của bộ thử.
VIETNAM_DENV1 = "PP269639"
DENV2 = "PP564622"


@pytest.fixture
def lab(session, monkeypatch):
    monkeypatch.setattr(passwords, "N", 2**10)
    seed_geo(session)
    return accounts.create_user(session, email="lab@example.org", display_name="Phòng A", password="mật khẩu đủ dài")


def genome(accession: str) -> str:
    with (FIXTURES / "dengue_small.fasta").open() as handle:
        return dict(read_fasta(handle))[accession]


def submit(session, lab, sequence: str, **fields) -> Sample:
    values = {
        "display_name": HOSTILE_NAME,
        "collection_date": "2012-12-19",
        "unit_code": "vn63:ha-noi",
        "host": "Homo sapiens",
    }
    return service.submit(session, lab, fasta=f">ten trong file\n{sequence}\n", today=TODAY, **(values | fields))


def claimed(session, work_dir: Path) -> JobContext:
    """Lấy job đứng đầu hàng đợi như worker làm, với một thư mục làm việc riêng."""
    work_dir.mkdir(parents=True, exist_ok=True)
    return JobContext(session=session, job=queue.claim(session, "w1"), work_dir=work_dir)


def run_job(session, work_dir: Path, kind: str, params: dict):
    queue.enqueue(session, kind, params, priority=100)
    return HANDLERS[kind](claimed(session, work_dir))


def check(session, lab, tmp_path, sequence: str, **fields) -> tuple[Sample, dict]:
    sample = submit(session, lab, sequence, **fields)
    context = claimed(session, tmp_path / f"ingest-{sample.id}")
    result = ingest_sample(context)
    # Worker ghi kết cục của job sau khi handler trả về; trạng thái mẫu hiện cho người nộp dựa cả vào đó.
    assert queue.finish(session, context.job, result)
    session.expire_all()
    return sample, result


def test_the_check_of_a_sample_refuses_what_is_not_a_submission(session, lab, tmp_path):
    imported = add_sample(session)
    for params, error in (
        ({"sample_id": 999_999}, LookupError),
        ({"sample_id": imported.id}, LookupError),  # bản ghi GenBank, không phải mẫu nộp
        ({"sample_id": "1; touch pwned"}, LookupError),
        ({"sample_id": 1, "tree_builder_args": "--seed 1; touch pwned"}, ValueError),
    ):
        queue.enqueue(session, "ingest_sample", params)
        with pytest.raises(error):
            ingest_sample(claimed(session, tmp_path))
    assert not list(tmp_path.rglob("*.fasta")) and not list(tmp_path.rglob("pwned"))


@pytest.mark.tools
def test_the_serotype_is_found_without_the_lab_naming_it(session, lab, tmp_path):
    sample, result = check(session, lab, tmp_path, genome(DENV2), collection_date="2023")

    alignment = session.get(SampleAlignment, sample.id)
    assert result == {
        "sample": sample.internal_id,
        "lineage": "denv2",
        "reject_code": None,
        "status": "accepted",
        "placed_on": [],  # chưa có dataset DENV2 nào để đặt lên
    }
    assert (sample.status, alignment.lineage, alignment.status) == ("accepted", "denv2", "aligned")
    assert alignment.valid_nt >= DENGUE["denv2"].min_valid_nt
    # Mỗi reference được thử một lần, mỗi lần là một bước có số đo.
    steps = session.scalars(select(JobStep.name).order_by(JobStep.position)).all()
    assert steps == ["nextclade-version", "align-denv1", "align-denv2", "align-denv3", "align-denv4"]
    assert service.describe(session, [sample.id])[0]["stage"] == "accepted"


@pytest.mark.tools
def test_a_sequence_that_is_not_dengue_is_rejected_with_the_reason(session, lab, tmp_path):
    junk = "".join(random.Random(1).choices("ACGT", k=10_700))

    sample, result = check(session, lab, tmp_path, junk)

    submission = session.get(Submission, sample.id)
    assert (result["status"], result["reject_code"], result["lineage"], result["placed_on"]) == (
        "rejected",
        "NOT_THIS_PATHOGEN",
        None,
        [],
    )
    assert (sample.status, submission.reject_code) == ("rejected", "NOT_THIS_PATHOGEN")
    assert submission.reject_message
    assert session.get(SampleAlignment, sample.id).status == "failed"
    described = service.describe(session, [sample.id])[0]
    assert (described["stage"], described["lineage"]) == ("rejected", None)


@pytest.mark.tools
def test_a_genome_with_too_few_readable_positions_after_alignment_is_rejected(session, lab, tmp_path):
    # Đủ A, C, G, T để qua kiểm tra lúc nộp, nhưng một phần là đoạn lạ gắn ở đuôi: sau khi gióng theo reference,
    # số vị trí đọc được không còn đủ để vào cây.
    real = genome(VIETNAM_DENV1)
    masked = sum(real.count(base) for base in "ACGT") - 9_900
    tail = "".join(random.Random(2).choices("ACGT", k=400))
    sequence = real[:300] + "N" * masked + real[300 + masked :] + tail
    assert sum(sequence.count(base) for base in "ACGT") >= 10_000

    sample, result = check(session, lab, tmp_path, sequence)

    submission = session.get(Submission, sample.id)
    alignment = session.get(SampleAlignment, sample.id)
    assert (result["status"], result["reject_code"]) == ("rejected", "TOO_FEW_VALID_SITES")
    assert (alignment.lineage, alignment.status) == ("denv1", "aligned")
    assert alignment.valid_nt < DENGUE["denv1"].min_valid_nt
    assert str(alignment.valid_nt) in submission.reject_message
    # Mẫu bị từ chối không được chọn vào build dù có kết quả gióng.
    assert sample.status == "rejected"


@pytest.mark.tools
def test_a_submitted_genome_becomes_a_provisional_tip_and_then_a_tip_of_the_next_build(
    session, client, lab, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "tool_threads", 2)
    monkeypatch.setattr(settings, "data_dir", str(tmp_path / "data"))
    import_genbank(session, FIXTURES / "dengue_small.tsv", FIXTURES / "dengue_small.fasta")
    # Genome sẽ được nộp không nằm trong dữ liệu có sẵn, nên cây đầu tiên không có nó.
    sequence = genome(VIETNAM_DENV1)
    session.execute(delete(Sample).where(Sample.accession == VIETNAM_DENV1))
    run_job(session, tmp_path / "align", "align_pending", {"lineage": "denv1"})
    eligible = session.scalar(
        select(func.count()).select_from(SampleAlignment).where(SampleAlignment.valid_nt >= 10_000)
    )
    dataset = DatasetDef(
        slug="dengue-denv1",
        title="DENV1 Việt Nam",
        pathogen="dengue",
        lineage="denv1",
        max_samples=eligible + 10,
        min_context_share=0.0,
    )
    session.add(dataset)
    session.flush()
    run_job(session, tmp_path / "build-1", "build_dataset", {"dataset": "dengue-denv1"})
    first_build = session.scalars(select(Build).where(Build.is_current)).one()
    # Việc gắn lại mẫu đã nộp được xếp ngay sau build; lúc này chưa có mẫu nào.
    assert place_pending(claimed(session, tmp_path / "place-0")) == {
        "dataset": "dengue-denv1",
        "build_id": first_build.id,
        "placed": 0,
        "unplaced": 0,
    }

    # --- Nộp và kiểm tra ---
    sample = submit(session, lab, sequence)
    ingest_work = tmp_path / "ingest"
    result = ingest_sample(claimed(session, ingest_work))

    session.expire_all()
    assert result == {
        "sample": sample.internal_id,
        "lineage": "denv1",
        "reject_code": None,
        "status": "accepted",
        "placed_on": ["dengue-denv1"],
    }
    placement = session.scalars(select(SamplePlacement)).one()
    tree_path = tmp_path / "data" / "builds" / "dengue-denv1" / f"b{first_build.id:06d}" / "auspice.json"
    base_names = node_names(json.loads(tree_path.read_text()))
    assert (placement.sample_id, placement.build_id) == (sample.id, first_build.id)
    assert placement.parent_node in base_names
    assert placement.branch_node is None or placement.branch_node in base_names
    assert 0 <= placement.attach_div <= placement.div
    assert placement.private_mutations >= 0 and placement.clade
    assert sample.internal_id not in base_names
    ingest_job = session.get(Submission, sample.id).job_id
    steps = session.scalars(select(JobStep.name).filter_by(job_id=ingest_job).order_by(JobStep.position)).all()
    assert steps[-1] == "place-dengue-denv1"

    # Công cụ chỉ thấy mã nội bộ: tên do người nộp gõ không nằm trong file nào của job, không lệnh nào bị chèn.
    for path in ingest_work.rglob("*"):
        if path.is_file():
            text = path.read_text(errors="replace")
            assert "Hà_Nội" not in text and "pwned" not in text and "ten trong file" not in text, path.name
    assert not list(tmp_path.rglob("pwned"))

    # Người xem thấy tip tạm; người nộp thấy mẫu của mình đã được đặt.
    tips = client.get("/api/datasets/dengue-denv1/placements").json()
    assert tips["buildId"] == first_build.id
    assert [(tip["internalId"], tip["displayName"]) for tip in tips["items"]] == [(sample.internal_id, HOSTILE_NAME)]
    assert service.describe(session, [sample.id])[0]["stage"] == "placed"

    # Job chạy lại (sau một sự cố) không kiểm tra lần hai và không tạo chỗ đặt thứ hai.
    queue.enqueue(session, "ingest_sample", {"sample_id": sample.id}, priority=100)
    again = ingest_sample(claimed(session, tmp_path / "ingest-again"))
    assert again == {"sample": sample.internal_id, "status": "accepted", "placed_on": ["dengue-denv1"]}
    assert session.scalar(select(func.count()).select_from(SamplePlacement)) == 1

    # Mất chỗ đặt (chẳng hạn build đổi) thì job gắn lại tìm ra đúng mẫu đã nộp, không đụng tới bản ghi GenBank.
    session.execute(delete(SamplePlacement))
    assert run_job(session, tmp_path / "place-1", "place_pending", {"dataset": "dengue-denv1"}) == {
        "dataset": "dengue-denv1",
        "build_id": first_build.id,
        "placed": 1,
        "unplaced": 0,
    }

    # --- Build kế tiếp ---
    second = build_then_place(claimed_build(session, tmp_path / "build-2"))
    session.expire_all()
    second_build = session.scalars(select(Build).where(Build.is_current)).one()
    assert second_build.id == second["build_id"] != first_build.id
    assert session.get(BuildSample, (second_build.id, sample.id)).role == "home"

    # Trong bản publish, tip mang mã nội bộ còn tên hiển thị là đúng tên người nộp đã gõ.
    published = tmp_path / "data" / "builds" / second_build.path
    tree = json.loads((published / "tree.json").read_text())
    names = json.loads((published / "tips.json").read_text())["displayName"]
    tip_names = [tree["name"][index] for index in tree["tipNode"]]
    assert names[tip_names.index(sample.internal_id)] == HOSTILE_NAME

    # Build xong thì việc gắn lại được xếp hàng; mẫu đã là tip chính thức nên không còn là tip tạm.
    queued = session.scalars(select(Job).where(Job.kind == "place_pending", Job.status == "queued")).one()
    assert (queued.params, queued.priority) == ({"dataset": "dengue-denv1"}, queue.INTERACTIVE)
    assert place_pending(claimed(session, tmp_path / "place-2"))["placed"] == 0
    assert client.get("/api/datasets/dengue-denv1/placements").json() == {"buildId": second_build.id, "items": []}
    described = service.describe(session, [sample.id])[0]
    assert (described["stage"], described["in_datasets"]) == (
        "in_tree",
        [{"dataset": "dengue-denv1", "title": "DENV1 Việt Nam"}],
    )


def claimed_build(session, work_dir: Path) -> JobContext:
    queue.enqueue(session, "build_dataset", {"dataset": "dengue-denv1"}, priority=100)
    return claimed(session, work_dir)
