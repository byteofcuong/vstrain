"""Nhận một lần nộp mẫu, và mô tả tình trạng của các mẫu đã nộp.

Các hàm ở đây chỉ flush; bên gọi (API) quyết định lúc commit.
"""

import datetime as dt
import hashlib
import re
from collections import defaultdict
from collections.abc import Sequence
from contextlib import suppress
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.accounts.service import record
from app.jobs import queue
from app.models import (
    AdminUnit,
    AppUser,
    Build,
    BuildSample,
    DatasetDef,
    Job,
    JobStatus,
    Sample,
    SampleAlignment,
    SamplePlacement,
    SampleSequence,
    SampleStatus,
    Submission,
    UnitLevel,
)
from app.pathogens import DENGUE
from app.submissions.validate import (
    CollectionDate,
    InvalidSubmission,
    Problem,
    SequenceLimits,
    check_submission,
    clean_collection_date,
)

PATHOGEN = "dengue"
HOME_COUNTRY = "Vietnam"
INGEST_JOB = "ingest_sample"
# Số mẫu của một người được nằm chờ kiểm tra cùng lúc, để một tài khoản không lấp đầy hàng đợi.
MAX_PENDING = 20
# Số mẫu một người được nộp trong 24 giờ. Mẫu được kiểm tra trong khoảng một giây rồi không còn là "đang chờ", nên
# trần ở trên không giới hạn tổng số; mỗi mẫu được nhận là một mẫu tạm phải gắn lại sau từng lần build.
MAX_PER_DAY = 200
_DAY = dt.timedelta(days=1)
_WAITING = (JobStatus.QUEUED.value, JobStatus.RUNNING.value)

# Việt Nam không có giờ mùa hè, nên một độ lệch cố định là đủ.
_VIETNAM_TIME = dt.timezone(dt.timedelta(hours=7))
_UNIT_CODE = re.compile(r"[a-z0-9]+:[a-z0-9-]+")


class TooManyPending(RuntimeError):
    """Người nộp đang có quá nhiều mẫu chờ kiểm tra."""


class TooManyToday(RuntimeError):
    """Người nộp đã nộp hết số mẫu được phép trong 24 giờ."""


def today_in_vietnam() -> dt.date:
    """Hôm nay theo giờ Việt Nam: mẫu lấy sáng nay ở Hà Nội không bị coi là "ngày mai" theo giờ của server."""
    return dt.datetime.now(_VIETNAM_TIME).date()


def sequence_limits() -> SequenceLimits:
    """Khoảng độ dài của một genome đủ để vào cây, tính từ cấu hình các lineage của pathogen."""
    lineages = DENGUE.values()
    return SequenceLimits(
        min_length=min(lineage.min_valid_nt for lineage in lineages),
        # Rộng hơn reference dài nhất 10%: đủ cho đoạn chèn và phần đầu mồi còn sót ở hai đầu.
        max_length=int(max(lineage.reference_length for lineage in lineages) * 1.1),
    )


def _unit_of(session: Session, code: str, date: CollectionDate | None) -> AdminUnit:
    """Đơn vị cấp tỉnh có mã `code`, còn hiệu lực trong khoảng ngày lấy mẫu."""
    unit = session.get(AdminUnit, code) if _UNIT_CODE.fullmatch(code) else None
    if unit is None or unit.level != UnitLevel.PROVINCE.value:
        raise InvalidSubmission([Problem("unitCode", "UNKNOWN_UNIT", "No province with this code")])
    if date is not None:
        started = unit.valid_from is None or unit.valid_from <= date.last
        ended = unit.valid_to is not None and unit.valid_to < date.first
        if not started or ended:
            raise InvalidSubmission(
                [Problem("unitCode", "UNIT_NOT_VALID_ON_DATE", "This province did not exist on the collection date")]
            )
    return unit


def submit(
    session: Session,
    user: AppUser,
    *,
    display_name: str,
    collection_date: str,
    unit_code: str,
    host: str | None,
    fasta: str,
    today: dt.date,
) -> Sample:
    """Lưu một mẫu vừa nộp ở trạng thái `received` và xếp job kiểm tra nó.

    Ném `InvalidSubmission` kèm mọi lỗi tìm được, `TooManyPending` hoặc `TooManyToday`; khi đó chưa có gì được ghi.
    """
    # Khoá dòng của tài khoản cho tới khi request này commit hoặc bị huỷ: các request cùng lúc của một người lần
    # lượt đếm rồi ghi, nên không cùng lọt qua hai trần bên dưới.
    session.execute(select(AppUser.id).where(AppUser.id == user.id).with_for_update())
    # Đang chờ là có job còn trong hàng đợi hoặc đang chạy, không phải là mẫu chưa có kết luận: job hỏng không tự
    # chạy lại và mẫu của nó ở lại trạng thái `received`, nên đếm theo trạng thái mẫu thì vài sự cố của worker đủ
    # khoá một phòng xét nghiệm vĩnh viễn.
    pending = session.scalar(
        select(func.count())
        .select_from(Submission)
        .join(Job, Job.id == Submission.job_id)
        .where(Submission.submitter_id == user.id, Job.status.in_(_WAITING))
    )
    if (pending or 0) >= MAX_PENDING:
        raise TooManyPending(f"{pending} submissions are still being checked")
    recent = session.scalar(
        select(func.count())
        .select_from(Submission)
        .where(Submission.submitter_id == user.id, Submission.created_at > func.now() - _DAY)
    )
    if (recent or 0) >= MAX_PER_DAY:
        raise TooManyToday(f"{recent} submissions in the last 24 hours")

    problems: list[Problem] = []
    cleaned = unit = None
    try:
        cleaned = check_submission(
            display_name=display_name,
            collection_date=collection_date,
            host=host,
            fasta=fasta,
            limits=sequence_limits(),
            today=today,
        )
    except InvalidSubmission as error:
        problems.extend(error.problems)
    # Tỉnh được xét cả khi trường khác sai, để form báo mọi lỗi trong một lượt.
    date = cleaned.date if cleaned else None
    if date is None:
        with suppress(InvalidSubmission):
            date = clean_collection_date(collection_date, today=today)
    try:
        unit = _unit_of(session, unit_code, date)
    except InvalidSubmission as error:
        problems.extend(error.problems)
    if problems or cleaned is None or unit is None:
        raise InvalidSubmission(problems)

    sample = Sample(
        display_name=cleaned.display_name,
        pathogen=PATHOGEN,
        source="submission",
        status=SampleStatus.RECEIVED.value,
        collection_date_raw=cleaned.date.raw,
        date_min=cleaned.date.first,
        date_max=cleaned.date.last,
        country=HOME_COUNTRY,
        division_raw=unit.name_vi,
        admin_unit_code=unit.code,
        region_code=unit.parent_code,
        geo_status="province",
        host=cleaned.host,
    )
    session.add(sample)
    session.flush()
    session.refresh(sample)  # mã nội bộ do database sinh ra
    session.add(
        SampleSequence(
            sample_id=sample.id,
            sequence=cleaned.sequence,
            length=len(cleaned.sequence),
            sha256=hashlib.sha256(cleaned.sequence.encode("ascii")).hexdigest(),
        )
    )
    # Đứng trước job dựng cây trong hàng đợi: người nộp đang chờ kết quả.
    job = queue.enqueue(session, INGEST_JOB, {"sample_id": sample.id}, priority=queue.INTERACTIVE)
    session.add(Submission(sample_id=sample.id, submitter_id=user.id, job_id=job.id))
    record(session, user.id, "sample_submitted", f"sample:{sample.internal_id}")
    session.flush()
    return sample


def _stage(status: str, job_status: str | None, in_tree: bool, placed: bool) -> str:
    """Mẫu đang ở đâu trên đường từ lúc nộp tới cây, nói bằng một từ cho giao diện."""
    running = job_status in _WAITING
    if status == SampleStatus.RECEIVED.value:
        # Job không còn, hoặc đã dừng mà mẫu vẫn chưa có kết luận: việc kiểm tra đã hỏng, cần người vận hành xem.
        return "processing" if running else "failed"
    if status != SampleStatus.ACCEPTED.value:
        return status  # 'rejected' | 'hidden'
    if in_tree:
        return "in_tree"
    if placed:
        return "placed"
    # Job ghi kết luận "đạt" trước rồi mới gắn mẫu lên cây: khi job còn chạy thì mẫu vẫn đang được xử lý.
    if running:
        return "processing"
    # Job hỏng sau khi mẫu đã đạt là hỏng ở bước gắn; mẫu được gắn lại sau lần build kế tiếp. Job xong êm mà không
    # có chỗ gắn nào thì mới thật là chưa có cây để gắn.
    return "placement_failed" if job_status == JobStatus.FAILED.value else "accepted"


def describe(session: Session, sample_ids: Sequence[int]) -> list[dict[str, Any]]:
    """Tình trạng của các mẫu đã nộp, theo đúng thứ tự `sample_ids`."""
    if not sample_ids:
        return []
    rows = session.execute(
        select(Sample, Submission, SampleAlignment, Job.status, SampleSequence.length, AppUser.display_name)
        .join(Submission, Submission.sample_id == Sample.id)
        .join(AppUser, AppUser.id == Submission.submitter_id)
        .outerjoin(SampleAlignment, SampleAlignment.sample_id == Sample.id)
        .outerjoin(Job, Job.id == Submission.job_id)
        .outerjoin(SampleSequence, SampleSequence.sample_id == Sample.id)
        .where(Sample.id.in_(sample_ids))
    ).all()

    # Chỉ build hiện hành mới có nghĩa với người xem: chỗ đặt trên một build cũ không còn được vẽ.
    current = select(Build.id, DatasetDef.slug, DatasetDef.title).join(DatasetDef).where(Build.is_current).subquery()
    member_of: dict[int, list[dict[str, str]]] = defaultdict(list)
    for sample_id, slug, title in session.execute(
        select(BuildSample.sample_id, current.c.slug, current.c.title)
        .join(current, current.c.id == BuildSample.build_id)
        .where(BuildSample.sample_id.in_(sample_ids))
        .order_by(current.c.slug)
    ):
        member_of[sample_id].append({"dataset": slug, "title": title})
    placed_on: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for placement, slug, title in session.execute(
        select(SamplePlacement, current.c.slug, current.c.title)
        .join(current, current.c.id == SamplePlacement.build_id)
        .where(SamplePlacement.sample_id.in_(sample_ids))
        .order_by(current.c.slug)
    ):
        placed_on[placement.sample_id].append(
            {
                "dataset": slug,
                "title": title,
                "clade": placement.clade,
                "private_mutations": placement.private_mutations,
            }
        )

    described = {}
    for sample, submission, alignment, job_status, length, submitter in rows:
        aligned = alignment is not None and alignment.status == "aligned"
        described[sample.id] = {
            "internal_id": sample.internal_id,
            "display_name": sample.display_name,
            "collection_date": sample.collection_date_raw,
            "unit_code": sample.admin_unit_code,
            "host": sample.host,
            "status": sample.status,
            "stage": _stage(sample.status, job_status, bool(member_of[sample.id]), bool(placed_on[sample.id])),
            "reject_code": submission.reject_code,
            "reject_message": submission.reject_message,
            "lineage": alignment.lineage if aligned else None,
            "coverage": alignment.coverage if aligned else None,
            "valid_nt": alignment.valid_nt if aligned else None,
            "sequence_length": length,
            "submitted_at": submission.created_at,
            "submitter_name": submitter,
            "in_datasets": member_of[sample.id],
            "placements": placed_on[sample.id],
        }
    return [described[sample_id] for sample_id in sample_ids if sample_id in described]


def list_submissions(
    session: Session, *, submitter_id: int | None, limit: int, offset: int
) -> tuple[list[dict[str, Any]], int]:
    """Một trang mẫu đã nộp, mới nhất trước; `submitter_id` là `None` thì lấy của mọi người (dành cho admin)."""
    mine = () if submitter_id is None else (Submission.submitter_id == submitter_id,)
    total = session.scalar(select(func.count()).select_from(Submission).where(*mine)) or 0
    sample_ids = session.scalars(
        select(Submission.sample_id).where(*mine).order_by(Submission.sample_id.desc()).limit(limit).offset(offset)
    ).all()
    return describe(session, sample_ids), total


def find_submission(session: Session, internal_id: str, *, submitter_id: int | None) -> dict[str, Any] | None:
    """Một mẫu đã nộp theo mã nội bộ; `None` nếu không có, hoặc không phải của `submitter_id`."""
    mine = () if submitter_id is None else (Submission.submitter_id == submitter_id,)
    sample_id = session.scalar(
        select(Submission.sample_id)
        .join(Sample, Sample.id == Submission.sample_id)
        .where(Sample.internal_id == internal_id, *mine)
    )
    described = describe(session, [sample_id]) if sample_id is not None else []
    return described[0] if described else None
