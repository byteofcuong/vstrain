import re
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.build.align import align_batch, align_pending
from app.geo.seed import seed_geo
from app.jobs import queue
from app.jobs.steps import JobContext
from app.models import Sample, SampleAlignment, SampleSequence
from app.pathogens import DENGUE, Lineage
from app.samples.importer import import_genbank, read_fasta
from tests.support import add_sample

FIXTURES = Path(__file__).parent / "fixtures"
DENV1 = DENGUE["denv1"]


@pytest.mark.parametrize("key", ["denv1", "denv2", "denv3", "denv4"])
def test_each_dengue_lineage_has_a_consistent_set_of_reference_files(key):
    lineage: Lineage = DENGUE[key]

    with lineage.reference_fasta.open() as handle:
        ((name, fasta_sequence),) = list(read_fasta(handle))
    genbank = lineage.reference_genbank.read_text()
    origin = re.sub(r"[\d\s]", "", genbank.split("ORIGIN", 1)[1].split("//")[0]).upper()

    assert fasta_sequence == origin
    assert len(fasta_sequence) == lineage.reference_length
    assert name in genbank
    assert lineage.annotation.is_file() and lineage.clades.is_file()


@pytest.fixture
def context(session, tmp_path) -> JobContext:
    seed_geo(session)
    import_genbank(session, FIXTURES / "dengue_small.tsv", FIXTURES / "dengue_small.fasta")
    queue.enqueue(session, "align")
    return JobContext(session=session, job=queue.claim(session, "w1"), work_dir=tmp_path)


def ids(session, *accessions: str) -> list[int]:
    if not accessions:
        return list(session.scalars(select(Sample.id).order_by(Sample.id)))
    return list(session.scalars(select(Sample.id).where(Sample.accession.in_(accessions))))


def alignment(session, accession: str) -> SampleAlignment:
    session.expire_all()
    return session.scalars(select(SampleAlignment).join(Sample).where(Sample.accession == accession)).one()


@pytest.mark.tools
def test_genomes_are_aligned_to_the_reference_length_and_stored_with_their_counts(session, context):
    counts = align_batch(context, DENV1, ids(session, "OQ426616", "MN912130"))

    stored = alignment(session, "OQ426616")
    assert counts == {"aligned": 2, "failed": 0}
    assert (stored.status, stored.lineage, stored.error) == ("aligned", "denv1", None)
    assert len(stored.aligned_sequence) == DENV1.reference_length
    assert set(stored.aligned_sequence) <= set("ACGTNRYKMSWBDHV-")
    assert stored.valid_nt == sum(stored.aligned_sequence.count(base) for base in "ACGT") > 10_000
    assert 0.9 < stored.coverage <= 1
    assert 0 < stored.substitutions < 0.15 * stored.valid_nt
    assert stored.tool.startswith("nextclade 3.")


@pytest.mark.tools
def test_the_file_given_to_the_tool_names_sequences_by_internal_id_only(session, context):
    sample = session.scalars(select(Sample).filter_by(accession="OQ426616")).one()
    sample.display_name = "Hà_Nội/01/2024; touch pwned"
    session.flush()

    align_batch(context, DENV1, ids(session, "OQ426616", "MN912130"))

    given = "\n".join(path.read_text() for path in context.work_dir.rglob("input.fasta"))
    headers = [line for line in given.splitlines() if line.startswith(">")]
    assert len(headers) == 2
    assert all(re.fullmatch(r">S\d{7}", header) for header in headers)
    assert "Hà_Nội" not in given and "OQ426616" not in given
    assert alignment(session, "OQ426616").status == "aligned"
    assert not list(context.work_dir.rglob("pwned"))


@pytest.mark.tools
def test_a_genome_of_another_serotype_is_failed_with_a_reason(session, context):
    counts = align_batch(context, DENV1, ids(session, "PP564622", "MN912130"))

    wrong = alignment(session, "PP564622")
    assert counts == {"aligned": 1, "failed": 1}
    assert (wrong.status, wrong.aligned_sequence) == ("failed", None)
    assert "divergent" in wrong.error


@pytest.mark.tools
def test_a_sequence_that_cannot_be_aligned_is_failed_without_stopping_the_batch(session, context):
    junk = add_sample(session, accession="JUNK0001")
    session.add(SampleSequence(sample_id=junk.id, sequence="ACGT" * 60, length=240, sha256="0" * 64))
    session.flush()

    counts = align_batch(context, DENV1, [junk.id, *ids(session, "MN912130")])

    assert counts == {"aligned": 1, "failed": 1}
    assert alignment(session, "JUNK0001").status == "failed"
    assert alignment(session, "JUNK0001").error
    assert alignment(session, "MN912130").status == "aligned"


@pytest.mark.tools
def test_a_partial_genome_is_aligned_but_has_too_few_valid_nucleotides_for_a_build(session, context):
    align_batch(context, DENV1, ids(session, "MT804526"))

    partial = alignment(session, "MT804526")
    assert partial.status == "aligned"
    assert 1_000 < partial.valid_nt < DENV1.min_valid_nt


@pytest.mark.tools
def test_aligning_again_replaces_the_previous_result(session, context):
    sample_ids = ids(session, "MN912130")
    align_batch(context, DENV1, sample_ids)
    session.execute(SampleAlignment.__table__.update().values(valid_nt=1))

    align_batch(context, DENV1, sample_ids)

    assert alignment(session, "MN912130").valid_nt > 10_000
    assert len(session.scalars(select(SampleAlignment)).all()) == 1


def step_names(session) -> list[str]:
    from app.models import JobStep

    session.expire_all()
    return list(session.scalars(select(JobStep.name).order_by(JobStep.position)))


@pytest.mark.tools
def test_align_pending_aligns_every_long_genome_against_the_reference_of_its_serotype(session, context):
    result = align_pending(context)

    by_lineage = dict(
        session.execute(select(SampleAlignment.lineage, func.count()).group_by(SampleAlignment.lineage)).all()
    )
    nothing = {"aligned": 0, "failed": 0}
    assert result == {
        "denv1": {"aligned": 32, "failed": 0},
        "denv2": {"aligned": 1, "failed": 0},
        "denv3": nothing,
        "denv4": nothing,
    }
    assert by_lineage == {"denv1": 32, "denv2": 1}
    # Đoạn gene E dài 1.479 nt không đủ dài để vào build nên không được gióng ở bước này.
    assert session.scalars(select(SampleAlignment).join(Sample).where(Sample.accession == "MT804526")).first() is None


@pytest.mark.tools
def test_align_pending_works_in_batches_and_only_does_what_is_missing(session, context):
    context.job.params = {"batch_size": 10, "lineage": "denv1"}

    first = align_pending(context)
    steps_after_first = step_names(session)
    second = align_pending(context)

    batches = ["denv1-001", "denv1-002", "denv1-003", "denv1-004"]
    assert first == {"denv1": {"aligned": 32, "failed": 0}}
    assert [name for name in steps_after_first if name.startswith("denv1-")] == batches
    assert second == {"denv1": {"aligned": 0, "failed": 0}}
    assert [name for name in step_names(session) if name.startswith("denv1-")] == batches


@pytest.mark.tools
def test_a_genome_whose_sequence_changed_is_aligned_again(session, context):
    context.job.params = {"lineage": "denv1"}
    align_pending(context)
    changed = session.scalars(select(Sample).filter_by(accession="MN912130")).one()
    session.execute(
        SampleSequence.__table__.update().where(SampleSequence.sample_id == changed.id).values(sha256="f" * 64)
    )

    assert align_pending(context) == {"denv1": {"aligned": 1, "failed": 0}}


def test_align_pending_rejects_an_unknown_lineage(session, tmp_path):
    queue.enqueue(session, "align_pending", {"lineage": "denv9; touch x"})
    context = JobContext(session=session, job=queue.claim(session, "w1"), work_dir=tmp_path)

    with pytest.raises(ValueError, match="Unknown lineage"):
        align_pending(context)


@pytest.mark.tools
def test_failed_alignments_are_left_alone_unless_a_retry_is_requested(session, context):
    # Mẫu DENV2 bị gán nhầm serotype: gióng theo reference DENV1 sẽ thất bại vì quá khác.
    mislabelled = session.scalars(select(Sample).filter_by(accession="PP564622")).one()
    mislabelled.meta = {**mislabelled.meta, "serotype_genbank": "denv1"}
    session.flush()
    context.job.params = {"lineage": "denv1"}

    first = align_pending(context)
    again = align_pending(context)
    context.job.params = {"lineage": "denv1", "retry_failed": True}
    retried = align_pending(context)

    assert first == {"denv1": {"aligned": 32, "failed": 1}}
    assert again == {"denv1": {"aligned": 0, "failed": 0}}
    assert retried == {"denv1": {"aligned": 0, "failed": 1}}


@pytest.mark.parametrize(
    ("percent_different", "status"),
    [(7, "aligned"), (19, "aligned"), (31, "failed")],
)
def test_divergence_threshold_keeps_sylvatic_genotypes_and_rejects_other_serotypes(percent_different, status):
    # Số quan sát trên 21.909 genome: trong một serotype tối đa khoảng 19% (genotype rừng của DENV2),
    # khác serotype khoảng 31%.
    from app.build.align import _alignment

    length = DENV1.reference_length
    aligned = "A" * length
    stats = {"totalSubstitutions": str(length * percent_different // 100), "coverage": "1.0", "errors": ""}

    assert _alignment(DENV1, aligned, stats)["status"] == status


def test_a_sequence_with_characters_that_are_not_nucleotides_never_reaches_the_tool(session, tmp_path):
    seed_geo(session)
    strange = add_sample(session, accession="ODD00001")
    session.add(
        SampleSequence(sample_id=strange.id, sequence="ACGT>fake\nheader€" + "A" * 50, length=66, sha256="1" * 64)
    )
    session.flush()
    queue.enqueue(session, "align")
    context = JobContext(session=session, job=queue.claim(session, "w1"), work_dir=tmp_path)

    counts = align_batch(context, DENV1, [strange.id])

    assert counts == {"aligned": 0, "failed": 1}
    assert "not nucleotide codes" in alignment(session, "ODD00001").error
    assert list(tmp_path.rglob("input.fasta")) == []
