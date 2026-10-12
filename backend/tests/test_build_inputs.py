import csv
import datetime as dt
import re

import pytest
from sqlalchemy import select

from app.build.inputs import augur_date, clade_definitions, start_build, write_inputs
from app.jobs import queue
from app.models import Build, BuildSample, DatasetDef, Sample, SampleAlignment
from app.pathogens import DENGUE
from tests.support import add_sample

DENV1 = DENGUE["denv1"]


@pytest.mark.parametrize(
    ("date_min", "date_max", "expected"),
    [
        (dt.date(2019, 3, 15), dt.date(2019, 3, 15), "2019-03-15"),
        (dt.date(2019, 3, 1), dt.date(2019, 3, 31), "2019-03-XX"),
        (dt.date(2020, 2, 1), dt.date(2020, 2, 29), "2020-02-XX"),
        (dt.date(2019, 1, 1), dt.date(2019, 12, 31), "2019-XX-XX"),
        # Khoảng lạ (không phải trọn tháng hay trọn năm) được nới ra mức thô hơn chứ không đoán một ngày.
        (dt.date(2019, 3, 10), dt.date(2019, 3, 20), "2019-03-XX"),
        (dt.date(2019, 3, 10), dt.date(2019, 5, 20), "2019-XX-XX"),
    ],
)
def test_a_date_range_is_written_in_the_form_augur_understands(date_min, date_max, expected):
    assert augur_date(date_min, date_max) == expected


def test_clade_definitions_keep_only_the_clades_of_the_lineage():
    rows = list(csv.DictReader(clade_definitions(DENV1).splitlines(), delimiter="\t"))

    assert len(rows) > 5
    assert {row["clade"].split("/")[0] for row in rows} == {"DENV1"}
    assert set(rows[0]) == {"clade", "gene", "site", "alt"}


def add_genome(session, name: str, aligned: str, **fields) -> Sample:
    defaults = {"date_min": dt.date(2019, 3, 15), "date_max": dt.date(2019, 3, 15), "collection_date_raw": "15/3/2019"}
    sample = add_sample(session, display_name=name, **(defaults | fields))
    session.add(
        SampleAlignment(
            sample_id=sample.id,
            lineage="denv1",
            status="aligned",
            aligned_sequence=aligned,
            valid_nt=10_500,
            sequence_sha256="0" * 64,
            tool="nextclade 3.24.0",
        )
    )
    session.flush()
    return sample


@pytest.fixture
def dataset(session) -> DatasetDef:
    dataset = DatasetDef(
        slug="dengue-denv1", title="DENV1; touch pwned", pathogen="dengue", lineage="denv1", max_samples=10
    )
    session.add(dataset)
    session.flush()
    return dataset


def test_starting_a_build_records_the_selected_samples_and_the_job(session, dataset):
    home = add_genome(session, "vn", "ACGT")
    abroad = add_genome(session, "th", "ACGT", country="Thailand")
    job = queue.enqueue(session, "build_dataset")

    build = start_build(session, dataset, job.id)

    members = dict(session.execute(select(BuildSample.sample_id, BuildSample.role).filter_by(build_id=build.id)).all())
    assert (build.dataset_id, build.job_id, build.is_current, build.path) == (dataset.id, job.id, False, None)
    assert members == {home.id: "home", abroad.id: "context"}


def test_a_build_without_any_eligible_sample_is_refused(session, dataset):
    job = queue.enqueue(session, "build_dataset")

    with pytest.raises(ValueError, match="No eligible samples"):
        start_build(session, dataset, job.id)

    assert session.scalars(select(Build)).all() == []


def test_input_files_carry_internal_ids_and_dates_and_nothing_else(session, dataset, tmp_path):
    first = add_genome(session, "Hà_Nội/01/2024; touch pwned", "AC-TN-")
    second = add_genome(
        session,
        "DENV1/Thailand/x",
        "ACGTAC",
        country="Thailand",
        date_min=dt.date(2018, 1, 1),
        date_max=dt.date(2018, 12, 31),
    )
    build = start_build(session, dataset, queue.enqueue(session, "build_dataset").id)

    count = write_inputs(session, build.id, DENV1, tmp_path)

    fasta = (tmp_path / "aligned.fasta").read_text()
    metadata = list(csv.DictReader((tmp_path / "metadata.tsv").open(), delimiter="\t"))
    everything = "".join(path.read_text() for path in tmp_path.iterdir())
    assert count == 2
    assert sorted(path.name for path in tmp_path.iterdir()) == ["aligned.fasta", "clades.tsv", "metadata.tsv"]
    # Dấu gạch (chỗ không có dữ liệu) được đổi thành N, như `augur align --fill-gaps`.
    assert fasta == f">{first.internal_id}\nACNTNN\n>{second.internal_id}\nACGTAC\n"
    assert metadata == [
        {"strain": first.internal_id, "date": "2019-03-15"},
        {"strain": second.internal_id, "date": "2018-XX-XX"},
    ]
    assert all(re.fullmatch(r"S\d{7}", row["strain"]) for row in metadata)
    for foreign_text in ("Hà_Nội", "touch", "Thailand", "15/3/2019", first.accession):
        assert foreign_text not in everything


def test_a_range_spanning_two_years_is_written_as_an_unknown_date():
    assert augur_date(dt.date(2019, 12, 1), dt.date(2020, 1, 31)) == "XXXX-XX-XX"
