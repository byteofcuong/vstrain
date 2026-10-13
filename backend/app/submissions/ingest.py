"""Job kiểm tra một mẫu vừa nộp: tìm serotype, gióng, quyết định nhận hay không, rồi gắn tạm lên cây.

Người nộp không phải khai serotype: mẫu được gióng thử theo reference của từng lineage, và chỉ lineage đủ gần
mới cho kết quả gióng hợp lệ (genome của serotype khác lệch khoảng 31%, ngưỡng là 25%).
"""

from typing import Any

from sqlalchemy import select

from app.build.align import align_sequences, nextclade_version, raw_sequences, store_alignments
from app.jobs.steps import JobContext
from app.models import Sample, SampleStatus, Submission
from app.pathogens import DENGUE, Lineage
from app.submissions.placement import place_sample

# Mã lý do từ chối, để giao diện dịch.
NOT_THIS_PATHOGEN = "NOT_THIS_PATHOGEN"  # không reference nào đủ gần
TOO_FEW_VALID_SITES = "TOO_FEW_VALID_SITES"  # gióng được nhưng đọc được quá ít vị trí


def _lineages(pathogen: str) -> list[Lineage]:
    if pathogen != "dengue":
        raise LookupError(f"No lineages configured for pathogen {pathogen!r}")
    return list(DENGUE.values())


def _closest(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Kết quả gióng tốt nhất: lineage gióng được và ít thay thế nhất.

    Không lineage nào gióng được thì lấy kết quả ít thay thế nhất, để lý do từ chối nói về reference gần nhất.
    """

    def rank(row: dict[str, Any]) -> tuple[bool, bool, int]:
        substitutions = row["substitutions"]
        return (row["status"] != "aligned", substitutions is None, substitutions or 0)

    return min(results, key=rank)


def check_sample(context: JobContext, sample: Sample, submission: Submission) -> dict[str, Any]:
    """Gióng mẫu theo từng lineage, ghi kết quả tốt nhất và kết luận: `accepted` hoặc `rejected` kèm lý do."""
    session = context.session
    (raw,) = raw_sequences(session, [sample.id])
    lineages = _lineages(sample.pathogen)
    version = nextclade_version(context)
    results = [
        align_sequences(context, lineage, [raw], name=f"align-{lineage.key}", tool_version=version)[0]
        for lineage in lineages
    ]
    best = _closest(results)
    lineage = next(one for one in lineages if one.key == best["lineage"])
    store_alignments(session, [best])

    if best["status"] != "aligned":
        code, message = NOT_THIS_PATHOGEN, best["error"]
    elif best["valid_nt"] < lineage.min_valid_nt:
        code = TOO_FEW_VALID_SITES
        message = (
            f"Only {best['valid_nt']} positions could be read after alignment to {lineage.key}; "
            f"at least {lineage.min_valid_nt} are needed"
        )
    else:
        code = message = None
    sample.status = (SampleStatus.ACCEPTED if code is None else SampleStatus.REJECTED).value
    submission.reject_code, submission.reject_message = code, message
    session.commit()
    return {"lineage": best["lineage"] if best["status"] == "aligned" else None, "reject_code": code}


def ingest_sample(context: JobContext) -> dict[str, Any]:
    """Job cho một mẫu vừa nộp (tham số `sample_id`).

    Chạy lại được: mẫu đã có kết luận thì không kiểm tra lần hai, chỉ đặt lại lên cây nếu nó đã được nhận.
    """
    context.check_params("sample_id")
    session = context.session
    sample_id = context.params.get("sample_id")
    found = (
        session.execute(
            select(Sample, Submission).join(Submission, Submission.sample_id == Sample.id).where(Sample.id == sample_id)
        ).one_or_none()
        if isinstance(sample_id, int)
        else None
    )
    if found is None:
        raise LookupError(f"No submitted sample with id {sample_id!r}")
    sample, submission = found

    result: dict[str, Any] = {"sample": sample.internal_id}
    if sample.status == SampleStatus.RECEIVED.value:
        result.update(check_sample(context, sample, submission))
    result["status"] = sample.status
    result["placed_on"] = place_sample(context, sample.id)
    return result
