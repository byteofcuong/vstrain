"""Gióng từng mẫu theo reference bằng Nextclade, một lần cho mỗi mẫu, và lưu kết quả.

`augur align` (MAFFT) gióng lại toàn bộ ở mỗi lần build: 72 giây ở 2.000 chuỗi, 318 giây ở 5.000 chuỗi và
tăng nhanh hơn tuyến tính. Nextclade gióng từng chuỗi độc lập với reference, nên kết quả của một mẫu không
phụ thuộc các mẫu khác và lưu lại được.
"""

import csv
import re
from collections.abc import Sequence
from typing import Any, Protocol

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.jobs.steps import JobContext
from app.models import Sample, SampleAlignment, SampleSequence
from app.pathogens import DENGUE, Lineage
from app.samples.importer import read_fasta

_TIMEOUT_SECONDS = 1800
# Mã nucleotide của IUPAC và dấu gạch; chuỗi đã được viết hoa lúc nhập.
_NUCLEOTIDES = re.compile(r"[ACGTURYKMSWBDHVN-]+")


def _int(value: str | None) -> int | None:
    return int(value) if value else None


def _float(value: str | None) -> float | None:
    return float(value) if value else None


def _alignment(lineage: Lineage, aligned: str | None, stats: dict[str, str] | None) -> dict[str, Any]:
    """Các cột kết quả của một mẫu, từ chuỗi đã gióng và dòng thống kê của Nextclade.

    Mọi kết quả có cùng bộ cột, vì cả lô được ghi bằng một câu lệnh.
    """
    stats = stats or {}
    result: dict[str, Any] = {
        "status": "failed",
        "aligned_sequence": None,
        "valid_nt": None,
        "coverage": _float(stats.get("coverage")),
        "substitutions": _int(stats.get("totalSubstitutions")),
        "deletions": _int(stats.get("totalDeletions")),
        "insertions": _int(stats.get("totalInsertions")),
        "missing": _int(stats.get("totalMissing")),
        "error": None,
    }
    if aligned is None or stats.get("errors") or not stats:
        return {**result, "error": stats.get("errors") or "Nextclade returned no alignment for this sequence"}
    if len(aligned) != lineage.reference_length:
        return {**result, "error": f"Aligned length {len(aligned)} differs from the reference"}
    if not _NUCLEOTIDES.fullmatch(aligned):
        return {**result, "error": "Aligned sequence contains characters that are not nucleotide codes"}

    valid_nt = sum(aligned.count(base) for base in "ACGT")
    # Nextclade vẫn gióng được genome của serotype khác (khoảng 30% vị trí khác reference), nên phải tự loại.
    divergence = (result["substitutions"] or 0) / max(valid_nt, 1)
    if divergence > lineage.max_divergence:
        return {
            **result,
            "error": f"Too divergent from the {lineage.key} reference ({divergence:.0%} of sites differ); "
            "probably another lineage",
        }
    return {**result, "status": "aligned", "aligned_sequence": aligned, "valid_nt": valid_nt}


def nextclade_version(context: JobContext) -> str:
    return context.run_tool("nextclade-version", ["nextclade", "--version"], timeout=60).log_tail.strip()


class RawSequence(Protocol):
    """Thứ cần biết về một mẫu để gióng nó: một dòng của truy vấn `raw_sequences`."""

    id: int
    internal_id: str
    sequence: str
    sha256: str


def raw_sequences(session: Session, sample_ids: Sequence[int]) -> Sequence[RawSequence]:
    return session.execute(
        select(Sample.id, Sample.internal_id, SampleSequence.sequence, SampleSequence.sha256)
        .join(SampleSequence, SampleSequence.sample_id == Sample.id)
        .where(Sample.id.in_(sample_ids))
        .order_by(Sample.id)
    ).all()


def is_nucleotide_text(sequence: str) -> bool:
    """Chuỗi chỉ gồm mã nucleotide, tức ghi ra file FASTA được mà không tạo ra dòng tiêu đề giả."""
    return _NUCLEOTIDES.fullmatch(sequence) is not None


def align_sequences(
    context: JobContext,
    lineage: Lineage,
    samples: Sequence[RawSequence],
    *,
    name: str = "align",
    tool_version: str | None = None,
) -> list[dict[str, Any]]:
    """Gióng một lô chuỗi theo reference của `lineage`; trả về một dòng `sample_alignment` cho mỗi mẫu, chưa ghi."""
    # Chuỗi có ký tự không phải mã nucleotide (xuống dòng, dấu ">", chữ ngoài ASCII) không được ghi ra file:
    # nó có thể tạo ra một dòng tiêu đề giả, hoặc làm hỏng cả lô.
    usable = [sample for sample in samples if is_nucleotide_text(sample.sequence)]
    aligned: dict[str, str] = {}
    stats: dict[str, dict[str, str]] = {}
    version = tool_version or "nextclade (not run)"
    if usable:
        folder = context.work_dir / name
        folder.mkdir(parents=True, exist_ok=True)
        # Công cụ chỉ thấy mã nội bộ: tên hiển thị của mẫu không bao giờ được ghi vào file này.
        with (folder / "input.fasta").open("w", encoding="ascii", newline="\n") as handle:
            for sample in usable:
                handle.write(f">{sample.internal_id}\n{sample.sequence}\n")

        version = tool_version or nextclade_version(context)
        context.run_tool(
            name,
            [
                "nextclade",
                "run",
                f"--input-ref={lineage.reference_fasta}",
                f"--input-annotation={lineage.annotation}",
                *lineage.nextclade_alignment_args,
                f"--output-fasta={folder / 'aligned.fasta'}",
                f"--output-tsv={folder / 'nextclade.tsv'}",
                f"--jobs={settings.tool_threads}",
                folder / "input.fasta",
            ],
            timeout=_TIMEOUT_SECONDS,
        )
        with (folder / "aligned.fasta").open(encoding="ascii") as handle:
            aligned = dict(read_fasta(handle))
        with (folder / "nextclade.tsv").open(encoding="utf-8", newline="") as handle:
            stats = {row["seqName"]: row for row in csv.DictReader(handle, delimiter="\t")}

    usable_ids = {sample.id for sample in usable}
    return [
        {
            "sample_id": sample.id,
            "lineage": lineage.key,
            "sequence_sha256": sample.sha256,
            "tool": version,
            **(
                _alignment(lineage, aligned.get(sample.internal_id), stats.get(sample.internal_id))
                if sample.id in usable_ids
                else {
                    **_alignment(lineage, None, None),
                    "error": "Sequence contains characters that are not nucleotide codes",
                }
            ),
        }
        for sample in samples
    ]


def store_alignments(session: Session, rows: Sequence[dict[str, Any]]) -> None:
    """Ghi kết quả gióng; mẫu đã có kết quả thì được thay bằng kết quả mới. Chỉ flush."""
    statement = insert(SampleAlignment).values(list(rows))
    replaced = {column: statement.excluded[column] for column in rows[0] if column != "sample_id"}
    replaced["aligned_at"] = statement.excluded.aligned_at
    session.execute(statement.on_conflict_do_update(index_elements=[SampleAlignment.sample_id], set_=replaced))


def align_batch(
    context: JobContext,
    lineage: Lineage,
    sample_ids: Sequence[int],
    *,
    name: str = "align",
    tool_version: str | None = None,
) -> dict[str, int]:
    """Gióng một lô mẫu và ghi kết quả vào `sample_alignment`; trả về số mẫu gióng được và không gióng được."""
    samples = raw_sequences(context.session, sample_ids)
    if not samples:
        return {"aligned": 0, "failed": 0}
    rows = align_sequences(context, lineage, samples, name=name, tool_version=tool_version)
    store_alignments(context.session, rows)
    context.session.commit()

    aligned_count = sum(1 for row in rows if row["status"] == "aligned")
    return {"aligned": aligned_count, "failed": len(rows) - aligned_count}


def _pending(context: JobContext, lineage: Lineage, *, retry_failed: bool) -> list[int]:
    """Genome đủ dài của lineage mà chưa có kết quả gióng, hoặc chuỗi đã đổi từ lần gióng trước."""
    stale = or_(SampleAlignment.sample_id.is_(None), SampleAlignment.sequence_sha256 != SampleSequence.sha256)
    if retry_failed:
        stale = or_(stale, SampleAlignment.status == "failed")
    return list(
        context.session.scalars(
            select(Sample.id)
            .join(SampleSequence, SampleSequence.sample_id == Sample.id)
            .outerjoin(SampleAlignment, SampleAlignment.sample_id == Sample.id)
            .where(
                Sample.pathogen == lineage.pathogen,
                Sample.meta["serotype_genbank"].astext == lineage.key,
                SampleSequence.length >= lineage.min_valid_nt,
                stale,
            )
            .order_by(Sample.id)
        )
    )


def align_pending(context: JobContext) -> dict[str, dict[str, int]]:
    """Job gióng mọi genome còn thiếu kết quả; chạy lại thì chỉ làm phần còn thiếu.

    Tham số: `lineage` (mặc định là mọi lineage), `batch_size` (mặc định 1000, tối đa 2000; mỗi lô là một bước) và
    `retry_failed` (gióng lại cả những mẫu đã thất bại, dùng sau khi đổi cấu hình).
    """
    context.check_params("lineage", "batch_size", "retry_failed")
    requested = context.params.get("lineage")
    if requested is not None and requested not in DENGUE:
        raise ValueError(f"Unknown lineage {requested!r}")
    batch_size = int(context.params.get("batch_size", 1000))
    # Mỗi mẫu là 13 tham số trong câu lệnh ghi kết quả; PostgreSQL nhận tối đa 65.535 tham số một câu lệnh.
    if not 1 <= batch_size <= 2000:
        raise ValueError("batch_size must be between 1 and 2000")

    version: str | None = None
    totals: dict[str, dict[str, int]] = {}
    for lineage in [DENGUE[requested]] if requested else DENGUE.values():
        pending = _pending(context, lineage, retry_failed=context.params.get("retry_failed") is True)
        counts = {"aligned": 0, "failed": 0}
        for number, start in enumerate(range(0, len(pending), batch_size), start=1):
            version = version or nextclade_version(context)
            name = f"{lineage.key}-{number:03d}"
            batch = align_batch(context, lineage, pending[start : start + batch_size], name=name, tool_version=version)
            for key, count in batch.items():
                counts[key] += count
            # File FASTA của lô đã nằm trong DB; giữ lại log và bảng thống kê là đủ để tra cứu.
            for big_file in ("input.fasta", "aligned.fasta"):
                (context.work_dir / name / big_file).unlink(missing_ok=True)
        totals[lineage.key] = counts
    return totals
