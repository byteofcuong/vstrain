"""Chuẩn bị một lần build: ghi lại mẫu được chọn và viết các file đầu vào cho công cụ.

File đầu vào chỉ chứa thứ do hệ thống sinh ra: mã nội bộ, ngày ở dạng chuẩn, chuỗi đã gióng. Tên hiển thị,
địa danh và ngày nguyên văn của người nộp không bao giờ được ghi vào đây (ADR-003).
"""

import csv
import datetime as dt
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.build.selection import inputs_hash, select_samples
from app.models import Build, BuildSample, DatasetDef, Sample, SampleAlignment
from app.pathogens import Lineage


def augur_date(date_min: dt.date, date_max: dt.date) -> str:
    """Khoảng ngày viết theo dạng Augur hiểu: "2019-03-15", "2019-03-XX" hoặc "2019-XX-XX"."""
    if date_min == date_max:
        return date_min.isoformat()
    if (date_min.year, date_min.month) == (date_max.year, date_max.month):
        return f"{date_min.year:04d}-{date_min.month:02d}-XX"
    if date_min.year == date_max.year:
        return f"{date_min.year:04d}-XX-XX"
    return "XXXX-XX-XX"  # khoảng vắt qua hai năm: dạng này không diễn tả được, coi như không biết ngày


def clade_definitions(lineage: Lineage) -> str:
    """Định nghĩa clade của riêng lineage này.

    File gốc chứa clade của cả bốn serotype. Lọc ra để một node của cây DENV1 không thể bị gán nhầm một clade
    DENV2 chỉ vì tình cờ mang đúng mấy axit amin trong định nghĩa.
    """
    lines = lineage.clades.read_text(encoding="utf-8").splitlines()
    kept = [line for line in lines[1:] if line.startswith(lineage.clade_prefix)]
    return "\n".join([lines[0], *kept]) + "\n"


def start_build(session: Session, dataset: DatasetDef, job_id: int) -> Build:
    """Chọn mẫu và ghi lại build cùng danh sách mẫu của nó."""
    choices = select_samples(session, dataset)
    if not choices:
        raise ValueError(f"No eligible samples for dataset {dataset.slug}")
    build = Build(dataset_id=dataset.id, job_id=job_id, inputs_hash=inputs_hash(session, choices))
    session.add(build)
    session.flush()
    # Truyền danh sách dòng riêng để SQLAlchemy tự chia lô: một câu lệnh chỉ nhận tối đa 65.535 tham số.
    session.execute(
        insert(BuildSample),
        [{"build_id": build.id, "sample_id": choice.sample_id, "role": choice.role} for choice in choices],
    )
    session.flush()
    return build


def write_inputs(session: Session, build_id: int, lineage: Lineage, folder: Path) -> int:
    """Viết `aligned.fasta`, `metadata.tsv` và `clades.tsv` vào `folder`; trả về số mẫu.

    Alignment được ghép từ chuỗi đã gióng sẵn của từng mẫu, nên build không có bước gióng hàng.
    """
    samples = session.execute(
        select(Sample.internal_id, Sample.date_min, Sample.date_max, SampleAlignment.aligned_sequence)
        .join(BuildSample, BuildSample.sample_id == Sample.id)
        .join(SampleAlignment, SampleAlignment.sample_id == Sample.id)
        .where(BuildSample.build_id == build_id)
        .order_by(Sample.id)
    )
    count = 0
    with (
        (folder / "aligned.fasta").open("w", encoding="ascii", newline="\n") as fasta,
        (folder / "metadata.tsv").open("w", encoding="ascii", newline="") as table,
    ):
        metadata = csv.writer(table, delimiter="\t", lineterminator="\n")
        metadata.writerow(["strain", "date"])
        for internal_id, date_min, date_max, aligned in samples:
            # Chỗ không có dữ liệu thành N, như `augur align --fill-gaps`: nếu để dấu gạch, TreeTime coi nó
            # là một trạng thái thứ năm và suy ra các "đột biến mất đoạn" giả ở hai đầu genome.
            fasta.write(f">{internal_id}\n{aligned.replace('-', 'N')}\n")
            metadata.writerow([internal_id, augur_date(date_min, date_max)])
            count += 1
    (folder / "clades.tsv").write_text(clade_definitions(lineage), encoding="utf-8", newline="\n")
    return count
