import datetime as dt
import hashlib
import io
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.geo.seed import seed_geo
from app.models import Sample, SampleSequence
from app.samples.importer import import_genbank, read_fasta

COLUMNS = ["accession", "strain", "date", "region", "country", "division", "location", "host", "serotype_genbank"]


def record(accession: str, **fields: str) -> dict[str, str]:
    defaults = {"strain": f"strain-{accession}", "date": "2018-01-07", "region": "Asia", "country": "Vietnam"}
    return {"accession": accession} | defaults | fields


def write_inputs(folder: Path, records: list[dict[str, str]], sequences: dict[str, str]) -> tuple[Path, Path]:
    metadata = folder / "metadata.tsv"
    lines = ["\t".join(COLUMNS)] + ["\t".join(row.get(column, "") for column in COLUMNS) for row in records]
    metadata.write_text("\n".join(lines) + "\n", encoding="utf-8")
    fasta = folder / "sequences.fasta"
    fasta.write_text("".join(f">{name}\n{sequence}\n" for name, sequence in sequences.items()), encoding="utf-8")
    return metadata, fasta


def run_import(session, folder: Path, records, sequences=None, **options):
    if sequences is None:
        sequences = {row["accession"]: "ACGTACGTAC" for row in records if row["accession"]}
    return import_genbank(session, *write_inputs(folder, records, sequences), **options)


def sample(session, accession: str) -> Sample:
    return session.scalars(select(Sample).filter_by(accession=accession)).one()


@pytest.fixture(autouse=True)
def geography(session):
    seed_geo(session)


def test_each_record_becomes_a_sample_with_its_sequence(session, tmp_path):
    records = [record("AB000001", strain="DENV1/Vietnam/2018/a"), record("AB000002"), record("AB000003")]
    sequences = {"AB000001": "acgtn", "AB000002": "ACGTACGT", "AB000003": "AC"}

    report = run_import(session, tmp_path, records, sequences)

    first = sample(session, "AB000001")
    stored = session.get(SampleSequence, first.id)
    assert (report.metadata_rows, report.created, report.updated) == (3, 3, 0)
    assert session.scalar(select(func.count()).select_from(Sample)) == 3
    assert (first.display_name, first.pathogen, first.source) == ("DENV1/Vietnam/2018/a", "dengue", "genbank")
    assert (stored.sequence, stored.length) == ("ACGTN", 5)
    assert stored.sha256 == hashlib.sha256(b"ACGTN").hexdigest()


def test_vietnamese_records_get_their_place_resolved_and_keep_the_raw_text(session, tmp_path):
    records = [
        record("VN000001", division="Nha Trang"),
        record("VN000002", division="South"),
        record("VN000003", division="Red River Delta", location="Hanoi"),
        record("VN000004"),
        record("VN000005", division="Atlantis"),
        record("TH000001", country="Thailand", division="Bangkok"),
    ]

    run_import(session, tmp_path, records)

    def place(accession: str) -> tuple:
        row = sample(session, accession)
        return row.geo_status, row.admin_unit_code, row.region_code, row.division_raw

    assert place("VN000001") == ("province", "vn63:khanh-hoa", "vnr:north-central-and-central-coast", "Nha Trang")
    assert place("VN000002") == ("region", None, "vnm:south", "South")
    assert place("VN000003") == ("province", "vn63:ha-noi", "vnr:red-river-delta", "Red River Delta")
    assert place("VN000004") == ("missing", None, None, None)
    assert place("VN000005") == ("unresolved", None, None, "Atlantis")
    assert place("TH000001") == ("foreign", None, None, "Bangkok")


def test_the_unit_follows_the_collection_date(session, tmp_path):
    records = [
        record("VN000001", division="Binh Dinh", date="2010-XX-XX"),
        record("VN000002", division="Binh Dinh", date="2026-01-15"),
    ]

    run_import(session, tmp_path, records)

    assert sample(session, "VN000001").admin_unit_code == "vn63:binh-dinh"
    assert sample(session, "VN000002").admin_unit_code == "vn34:gia-lai"


def test_partial_dates_become_ranges_and_malformed_dates_are_counted(session, tmp_path):
    records = [
        record("AB000001", date="2019-XX-XX"),
        record("AB000002", date="XXXX-XX-XX"),
        record("AB000003", date="07/01/2018"),
    ]

    report = run_import(session, tmp_path, records)

    def dates(accession: str) -> tuple:
        row = sample(session, accession)
        return row.collection_date_raw, row.date_min, row.date_max

    assert dates("AB000001") == ("2019-XX-XX", dt.date(2019, 1, 1), dt.date(2019, 12, 31))
    assert dates("AB000002") == ("XXXX-XX-XX", None, None)
    assert dates("AB000003") == ("07/01/2018", None, None)
    assert (report.created, report.invalid_date) == (3, 1)


def test_importing_again_creates_no_duplicates_and_keeps_internal_ids(session, tmp_path):
    records = [record("AB000001"), record("AB000002")]
    run_import(session, tmp_path, records)
    ids_before = {row.accession: row.internal_id for row in session.scalars(select(Sample))}

    report = run_import(session, tmp_path, records)

    session.expire_all()
    assert (report.created, report.updated) == (0, 2)
    assert {row.accession: row.internal_id for row in session.scalars(select(Sample))} == ids_before
    assert session.scalar(select(func.count()).select_from(SampleSequence)) == 2


def test_a_record_that_changed_upstream_is_updated_in_place(session, tmp_path):
    run_import(session, tmp_path, [record("AB000001", division="South")], {"AB000001": "ACGT"})
    internal_id = sample(session, "AB000001").internal_id

    run_import(session, tmp_path, [record("AB000001", division="Dak Lak")], {"AB000001": "ACGTTT"})

    session.expire_all()
    updated = sample(session, "AB000001")
    assert (updated.internal_id, updated.admin_unit_code, updated.geo_status) == (
        internal_id,
        "vn63:dak-lak",
        "province",
    )
    assert session.get(SampleSequence, updated.id).sequence == "ACGTTT"


def test_records_without_accession_or_sequence_are_counted_and_do_not_stop_the_batch(session, tmp_path):
    records = [record("AB000001"), record(""), record("AB000003"), record("AB000001", strain="trùng")]
    sequences = {"AB000001": "ACGT", "ZZ999999": "ACGT"}

    report = run_import(session, tmp_path, records, sequences)

    assert session.scalars(select(Sample.accession)).all() == ["AB000001"]
    assert sample(session, "AB000001").display_name == "strain-AB000001"
    assert (report.metadata_rows, report.created) == (4, 1)
    assert (report.missing_accession, report.duplicate_accession) == (1, 1)
    assert (report.missing_sequence, report.sequence_without_metadata) == (1, 1)


def test_the_remaining_columns_are_kept_as_metadata_without_empty_values(session, tmp_path):
    run_import(session, tmp_path, [record("AB000001", host="Homo sapiens", serotype_genbank="denv1")])

    row = sample(session, "AB000001")

    assert row.host == "Homo sapiens"
    assert row.meta == {"region": "Asia", "serotype_genbank": "denv1"}


def test_all_records_are_imported_when_they_span_several_batches(session, tmp_path):
    records = [record(f"AB00000{number}") for number in range(1, 6)]

    report = run_import(session, tmp_path, records, batch_size=2)

    assert report.created == 5
    assert session.scalar(select(func.count()).select_from(SampleSequence)) == 5


def test_fasta_reader_joins_wrapped_lines_and_keeps_only_the_identifier():
    handle = io.StringIO(">AB000001 Dengue virus 1 isolate x\nacgt\nNNAC\n\n>AB000002\nGG\n")

    assert list(read_fasta(handle)) == [("AB000001", "ACGTNNAC"), ("AB000002", "GG")]
