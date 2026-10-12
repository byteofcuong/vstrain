"""Nhập bản ghi GenBank từ kết quả ingest của Nextstrain: một file metadata TSV và một file FASTA.

Khoá của bản ghi là accession, nên chạy lại lệnh chỉ cập nhật chứ không tạo bản ghi trùng.
"""

import csv
import hashlib
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

from sqlalchemy import literal_column
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.geo.normalize import place_key
from app.geo.resolve import GeoStatus, PlaceResolver
from app.models import Sample, SampleSequence
from app.samples.dates import parse_collection_date

# Cột của file metadata được đưa vào cột riêng của bảng `sample`; các cột còn lại vào `meta`.
_MAPPED_COLUMNS = {"accession", "strain", "date", "country", "division", "location", "host"}
_HOME_COUNTRY_KEY = "vietnam"


@dataclass
class ImportReport:
    metadata_rows: int = 0
    created: int = 0
    updated: int = 0
    missing_accession: int = 0
    duplicate_accession: int = 0
    missing_sequence: int = 0  # có metadata nhưng không có chuỗi trong file FASTA
    sequence_without_metadata: int = 0
    invalid_date: int = 0  # vẫn được nhập, nhưng không có khoảng ngày


def read_fasta(handle: TextIO) -> Iterator[tuple[str, str]]:
    """Từng cặp (mã, chuỗi); mã là từ đầu tiên của dòng tiêu đề, chuỗi được nối liền và viết hoa."""
    name: str | None = None
    parts: list[str] = []
    for line in handle:
        line = line.strip()
        if line.startswith(">"):
            if name is not None:
                yield name, "".join(parts).upper()
            name, parts = line[1:].split(maxsplit=1)[0] if len(line) > 1 else "", []
        elif line and name is not None:
            parts.append(line)
    if name is not None:
        yield name, "".join(parts).upper()


def _read_metadata(path: Path, report: ImportReport) -> dict[str, dict[str, str]]:
    records: dict[str, dict[str, str]] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            report.metadata_rows += 1
            accession = (row.get("accession") or "").strip()
            if not accession:
                report.missing_accession += 1
            elif accession in records:
                report.duplicate_accession += 1
            else:
                records[accession] = row
    return records


def _sample_values(
    accession: str, row: dict[str, str], pathogen: str, resolver: PlaceResolver, report: ImportReport
) -> dict[str, Any]:
    def value(column: str) -> str | None:
        return (row.get(column) or "").strip() or None

    raw_date = value("date")
    try:
        dates = parse_collection_date(raw_date)
    except ValueError:
        report.invalid_date += 1
        dates = None
    date_min, date_max = dates if dates else (None, None)

    if place_key(value("country")) == _HOME_COUNTRY_KEY:
        # Địa danh gốc được lưu nguyên văn (không cắt khoảng trắng) bên cạnh kết quả phân giải.
        place = resolver.resolve(row.get("division"), row.get("location"), date_min, date_max)
        status, unit_code, region_code = place.status, place.unit_code, place.region_code
    else:
        status, unit_code, region_code = GeoStatus.FOREIGN, None, None

    return {
        "display_name": value("strain") or accession,
        "pathogen": pathogen,
        "source": "genbank",
        "accession": accession,
        "collection_date_raw": raw_date,
        "date_min": date_min,
        "date_max": date_max,
        "country": value("country"),
        "division_raw": row.get("division") or None,
        "location_raw": row.get("location") or None,
        "admin_unit_code": unit_code,
        "region_code": region_code,
        "geo_status": status.value,
        "host": value("host"),
        "meta": {column: text for column, text in row.items() if column not in _MAPPED_COLUMNS and text},
    }


def _upsert(session: Session, batch: list[tuple[dict[str, Any], str]], report: ImportReport) -> None:
    samples = [values for values, _ in batch]
    statement = insert(Sample).values(samples)
    changed = {column: statement.excluded[column] for column in samples[0] if column != "accession"}
    result = session.execute(
        statement.on_conflict_do_update(index_elements=[Sample.accession], set_=changed).returning(
            Sample.id,
            Sample.accession,
            # xmax = 0 chỉ đúng với dòng vừa được chèn mới, không đúng với dòng được cập nhật.
            literal_column("(sample.xmax = 0)").label("created"),
        )
    )
    id_of: dict[str, int] = {}
    for sample_id, accession, created in result:
        id_of[accession] = sample_id
        report.created += created
        report.updated += not created

    sequences = [
        {
            "sample_id": id_of[values["accession"]],
            "sequence": sequence,
            "length": len(sequence),
            "sha256": hashlib.sha256(sequence.encode()).hexdigest(),
        }
        for values, sequence in batch
    ]
    statement = insert(SampleSequence).values(sequences)
    session.execute(
        statement.on_conflict_do_update(
            index_elements=[SampleSequence.sample_id],
            set_={column: statement.excluded[column] for column in ("sequence", "length", "sha256")},
            # Chuỗi không đổi thì không ghi lại: nhập lại 59 nghìn bản ghi không phải viết lại gần 300 MB.
            where=SampleSequence.sha256 != statement.excluded.sha256,
        )
    )
    session.commit()


def _batches(items: Iterable[Any], size: int) -> Iterator[list[Any]]:
    batch: list[Any] = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def import_genbank(
    session: Session, metadata_path: Path, fasta_path: Path, *, pathogen: str = "dengue", batch_size: int = 500
) -> ImportReport:
    """Nhập hoặc cập nhật mẫu; ghi theo từng lô và commit sau mỗi lô."""
    report = ImportReport()
    records = _read_metadata(metadata_path, report)
    resolver = PlaceResolver.load(session)

    def matched() -> Iterator[tuple[dict[str, Any], str]]:
        with fasta_path.open(encoding="utf-8") as handle:
            for accession, sequence in read_fasta(handle):
                row = records.pop(accession, None)
                if row is None:
                    report.sequence_without_metadata += 1
                else:
                    yield _sample_values(accession, row, pathogen, resolver, report), sequence

    for batch in _batches(matched(), batch_size):
        _upsert(session, batch, report)

    report.missing_sequence = len(records)
    return report
