import csv
import json
import re
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.build.align import align_pending
from app.build.pipeline import build_dataset, republish_build, tip_names, tree_command
from app.config import settings
from app.geo.seed import seed_geo
from app.jobs import queue
from app.jobs.steps import JobContext
from app.jobs.tools import run_tool
from app.models import Build, BuildSample, DatasetDef, JobStep, Sample, SampleAlignment, SampleSequence
from app.pathogens import DENGUE
from app.samples.importer import import_genbank
from tests.support import add_sample, make_build

FIXTURES = Path(__file__).parent / "fixtures"
DENV1 = DENGUE["denv1"]
HOSTILE_NAME = "Hà_Nội/01/2024; touch pwned"


def new_context(session, work_dir: Path, kind: str, params: dict) -> JobContext:
    work_dir.mkdir(parents=True, exist_ok=True)  # worker thật cũng tạo thư mục riêng cho từng job
    queue.enqueue(session, kind, params)
    return JobContext(session=session, job=queue.claim(session, "w1"), work_dir=work_dir)


def test_tip_names_are_read_from_a_deep_tree_without_recursion():
    tree = {"name": "tip-0"}
    for depth in range(1, 5000):
        tree = {"name": f"node-{depth}", "children": [tree, {"name": f"tip-{depth}"}]}

    assert tip_names({"tree": tree}) == {f"tip-{depth}" for depth in range(5000)}


def test_a_build_for_an_unknown_dataset_fails_without_running_anything(session, tmp_path):
    context = new_context(session, tmp_path, "build_dataset", {"dataset": "dengue-denv1; touch pwned"})

    with pytest.raises(LookupError, match="No dataset"):
        build_dataset(context)

    assert list(tmp_path.iterdir()) == []
    assert session.scalars(select(Build)).all() == []


@pytest.mark.tools
def test_a_small_dataset_is_built_from_stored_alignments_step_by_step(session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "tool_threads", 2)
    monkeypatch.setattr(settings, "data_dir", str(tmp_path / "data"))
    seed_geo(session)
    import_genbank(session, FIXTURES / "dengue_small.tsv", FIXTURES / "dengue_small.fasta")
    align_pending(new_context(session, tmp_path / "align", "align_pending", {"lineage": "denv1"}))
    eligible = session.scalar(
        select(func.count()).select_from(SampleAlignment).where(SampleAlignment.valid_nt >= DENV1.min_valid_nt)
    )
    # Trần thấp hơn số mẫu đủ điều kiện một đơn vị, để còn một mẫu nằm ngoài build dùng thử việc đặt mẫu.
    session.add(
        DatasetDef(
            slug="dengue-denv1",
            title="DENV1; touch pwned",
            pathogen="dengue",
            lineage="denv1",
            max_samples=eligible - 1,
            min_context_share=0.0,
        )
    )
    named = session.scalars(select(Sample).filter_by(accession="OQ426616")).one()
    named.display_name = HOSTILE_NAME
    session.flush()
    work = tmp_path / "build"

    result = build_dataset(new_context(session, work, "build_dataset", {"dataset": "dengue-denv1"}))

    session.expire_all()
    build = session.scalars(select(Build)).one()
    members = set(session.scalars(select(Sample.internal_id).join(BuildSample).where(BuildSample.build_id == build.id)))
    steps = session.scalars(select(JobStep).filter_by(job_id=build.job_id).order_by(JobStep.position)).all()
    auspice = json.loads((work / "auspice.json").read_text())
    tips = tip_names(auspice)

    # Mỗi bước là một dòng job_step có số đo; không có bước gióng hàng.
    assert [step.name for step in steps] == [
        "select",
        "prepare",
        "tree",
        "refine",
        "ancestral",
        "translate",
        "clades",
        "export",
        "publish",
    ]
    assert {step.status for step in steps} == {"succeeded"}
    for step in steps[2:8]:
        assert step.metrics["wall_seconds"] > 0 and step.metrics["max_rss_mb"] > 0, step.name

    # Cây chứa đúng các mẫu của build, gọi bằng mã nội bộ; mẫu có tên tiếng Việt nằm trong cây.
    assert eligible > 20
    assert (result["selected"], len(tips)) == (eligible - 1, eligible - 1 - len(result["dropped"]))
    assert tips == members
    assert all(re.fullmatch(r"S\d{7}", tip) for tip in tips)
    assert named.internal_id in tips
    assert (build.sample_count, build.finished_at is not None) == (len(tips), True)
    assert result["build_id"] == build.id

    # Build được publish và thành bản hiện hành; manifest mô tả đúng cây vừa dựng.
    manifest = json.loads((tmp_path / "data" / "builds" / build.path / "manifest.json").read_text())
    assert (build.is_current, result["path"]) == (True, build.path)
    assert manifest["counts"]["tips"] == len(tips)
    assert manifest["dataset"]["title"] == "DENV1; touch pwned"

    # Công cụ không thấy tên hiển thị, accession hay tiêu đề dataset, và không lệnh nào bị chèn.
    for path in work.rglob("*"):
        if path.is_file() and path.suffix in {".fasta", ".tsv", ".json", ".nwk", ".log", ".treefile"}:
            text = path.read_text(errors="replace")
            assert "Hà_Nội" not in text and "pwned" not in text and "OQ426616" not in text, path.name
    assert not list(tmp_path.rglob("pwned"))

    # Cây xuất ra dùng được làm cây nền cho Nextclade: đặt thử mẫu nằm ngoài build.
    outside = session.execute(
        select(Sample.internal_id, SampleSequence.sequence)
        .join(SampleSequence, SampleSequence.sample_id == Sample.id)
        .join(SampleAlignment, SampleAlignment.sample_id == Sample.id)
        .where(
            SampleAlignment.valid_nt >= DENV1.min_valid_nt,
            Sample.internal_id.not_in(members | set(result["dropped"])),
        )
    ).one()
    (work / "outside.fasta").write_text(f">{outside.internal_id}\n{outside.sequence}\n")
    placing = new_context(session, work, "place", {})
    placing.run_tool(
        "place",
        [
            "nextclade",
            "run",
            f"--input-ref={DENV1.reference_fasta}",
            "--input-tree=auspice.json",
            *DENV1.nextclade_alignment_args,
            "--output-tsv=placed.tsv",
            "outside.fasta",
        ],
        timeout=300,
    )
    with (work / "placed.tsv").open(newline="") as handle:
        (placed,) = list(csv.DictReader(handle, delimiter="\t"))
    assert (placed["seqName"], placed["errors"]) == (outside.internal_id, "")
    assert placed["clade"].startswith("DENV1/")


def test_a_published_build_can_be_published_again_as_a_job(session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    seed_geo(session)
    dataset = DatasetDef(slug="dengue-denv1", title="DENV1", pathogen="dengue", lineage="denv1", max_samples=10)
    session.add(dataset)
    session.flush()
    sample = add_sample(session, country="Thailand")
    build = make_build(session, dataset, [sample], tmp_path / "builds", tmp_path)

    result = republish_build(new_context(session, tmp_path / "job", "publish_build", {"build_id": build.id}))

    session.expire_all()
    assert result == {"build_id": build.id, "path": build.path}
    assert (tmp_path / "builds" / build.path / "tree.json").is_file()


@pytest.mark.parametrize("build_id", [999_999, "1; touch pwned", None])
def test_publishing_an_unknown_build_fails_cleanly(session, tmp_path, build_id):
    with pytest.raises(LookupError, match="No build"):
        republish_build(new_context(session, tmp_path, "publish_build", {"build_id": build_id}))


def test_the_tree_command_carries_the_seed_of_the_lineage():
    command = tree_command(DENV1)

    assert command[command.index("--seed") + 1] == str(DENV1.tree_seed)


@pytest.mark.tools
def test_iqtree_runs_with_the_fixed_seed(tmp_path, monkeypatch):
    import random

    monkeypatch.setattr(settings, "tool_threads", 2)
    rng = random.Random(7)
    root = [rng.choice("ACGT") for _ in range(600)]
    with (tmp_path / "aligned.fasta").open("w", encoding="ascii", newline="\n") as handle:
        for number in range(8):
            sequence = [rng.choice("ACGT") if rng.random() < 0.05 else base for base in root]
            handle.write(f">S{number:07d}\n{''.join(sequence)}\n")

    run_tool(tree_command(DENV1), cwd=tmp_path, log_path=tmp_path / "tree.log", timeout=120)

    assert re.search(rf"^Seed:\s+{DENV1.tree_seed}\b", (tmp_path / "tree.log").read_text(), flags=re.MULTILINE)
    assert (tmp_path / "tree.treefile").is_file()
