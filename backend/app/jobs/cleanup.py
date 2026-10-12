"""Dọn thư mục làm việc của job đã kết thúc.

Mỗi job có một thư mục riêng chứa file trung gian và log của công cụ (một build 2.000 mẫu chiếm vài trăm MB).
Kết quả cần giữ đã được chép sang chỗ bền vững lúc publish, nên thư mục này chỉ còn giá trị để tìm lỗi và
được xoá sau một thời gian.
"""

import datetime as dt
import re
import shutil
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Job, JobStatus

# Tên thư mục do worker đặt: `job-<id>`. 18 chữ số là đủ cho mọi giá trị BIGINT.
_WORK_DIR = re.compile(r"job-([0-9]{1,18})")
_CHUNK = 1000


def purge_work_dirs(session: Session, work_root: Path, older_than: dt.timedelta) -> int:
    """Xoá thư mục làm việc của các job đã kết thúc trước đây hơn `older_than`; trả về số thư mục đã xoá.

    Chỉ xoá thư mục thật, nằm ngay trong `work_root`, có tên đúng dạng và ứng với một job đã kết thúc trong DB.
    """
    if not work_root.is_dir():
        return 0
    folders: dict[int, Path] = {}
    for entry in work_root.iterdir():
        match = _WORK_DIR.fullmatch(entry.name)
        # Liên kết tượng trưng bị bỏ qua: xoá theo nó là xoá thứ nằm ngoài thư mục làm việc.
        if match and not entry.is_symlink() and entry.is_dir():
            folders[int(match[1])] = entry

    job_ids = sorted(folders)
    removed = 0
    for start in range(0, len(job_ids), _CHUNK):
        finished = session.scalars(
            select(Job.id).where(
                Job.id.in_(job_ids[start : start + _CHUNK]),
                Job.status.in_((JobStatus.SUCCEEDED.value, JobStatus.FAILED.value)),
                Job.finished_at < func.now() - older_than,
            )
        ).all()
        for job_id in finished:
            shutil.rmtree(folders[job_id], ignore_errors=True)
            removed += 1
    return removed
