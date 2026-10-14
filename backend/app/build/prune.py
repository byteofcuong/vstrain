"""Dọn bản publish đã bị thay thế và build cũ.

Mỗi lần publish lại (sửa địa danh, sửa mẫu) để lại một thư mục `p-<hash>` mà không dòng nào còn trỏ tới; mỗi lần
dựng lại để lại build cũ cùng cây và bản publish của nó. Không dọn thì thư mục `builds/` chỉ lớn lên.

Thứ bị xoá ở đây là file mà nginx đang phát, nên mọi phép xoá đều đi từ một dòng `build` trong database tới đúng thư
mục của nó, và build hiện hành cùng bản publish nó đang trỏ tới không bao giờ nằm trong danh sách.
"""

import datetime as dt
import logging
import re
import shutil
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.build.publish import build_folder, builds_root
from app.models import Build, DatasetDef, Job, JobStatus

log = logging.getLogger(__name__)

# Tên thư mục publish do `publish_build` đặt: 12 chữ số hex đầu của hash nội dung.
_PUBLICATION = re.compile(r"p-[0-9a-f]{12}")
# Dưới một ngày thì một bản vừa bị thay thế có thể bị xoá khi trình duyệt còn đang tải các cột của nó.
_SHORTEST_RETENTION = dt.timedelta(days=1)
_UNFINISHED = (JobStatus.QUEUED.value, JobStatus.RUNNING.value)


def _real_folder(path: Path) -> bool:
    """Một thư mục thật: liên kết tượng trưng bị bỏ qua, vì xoá theo nó là xoá thứ nằm ngoài thư mục builds."""
    return not path.is_symlink() and path.is_dir()


def _replaced_publications(root: Path, dataset: DatasetDef, build: Build) -> list[Path]:
    """Các thư mục publish của `build` mà dòng build không còn trỏ tới."""
    folder = build_folder(dataset, build)
    in_use = (build.path or "").removeprefix(f"{folder}/")
    # Dòng build phải trỏ vào một bản publish nằm ngay trong thư mục của chính nó; không thì không đoán.
    if not _PUBLICATION.fullmatch(in_use) or not _real_folder(root / folder / in_use):
        return []
    return sorted(
        entry
        for entry in (root / folder).iterdir()
        if _PUBLICATION.fullmatch(entry.name) and entry.name != in_use and _real_folder(entry)
    )


def _remove_build(session: Session, root: Path, dataset: DatasetDef, build_id: int) -> bool:
    """Xoá thư mục rồi dòng của một build cũ; trả về có xoá được không. Chỉ flush.

    Thư mục trước, dòng sau: hỏng giữa chừng thì còn một dòng trỏ tới thư mục đã mất, và lần dọn sau xoá nốt dòng
    đó. Làm ngược lại thì còn một thư mục không dòng nào biết tới, không bao giờ được dọn.
    """
    # Khoá dòng, rồi đọc lại nó: một job publish chạy cùng lúc có thể vừa làm build này thành bản hiện hành.
    locked = select(Build).where(Build.id == build_id).with_for_update(skip_locked=True)
    build = session.scalars(locked.execution_options(populate_existing=True)).one_or_none()
    if build is None or build.is_current:
        return False
    folder = root / build_folder(dataset, build)
    try:
        if folder.is_symlink():
            raise OSError(f"{folder} is a symbolic link")
        if folder.exists():
            shutil.rmtree(folder)
    except OSError:
        log.warning("Could not remove the folder of build %s; its row is kept", build_id, exc_info=True)
        return False
    session.execute(delete(Build).where(Build.id == build_id))
    session.flush()
    return True


def prune_builds(
    session: Session, *, now: dt.datetime, retention: dt.timedelta, keep: int, root: Path | None = None
) -> dict[str, int]:
    """Xoá bản publish đã bị thay thế và build cũ; trả về số thư mục publish và số build đã xoá. Chỉ flush.

    Mỗi dataset giữ build hiện hành và `keep` build mới nhất ngoài nó. Một build nằm ngoài số đó bị xoá khi nó được
    tạo trước `now - retention`, build hiện hành của dataset (nếu có) cũng được publish lần cuối trước mốc đó, và
    job của nó không còn chờ hay đang chạy. Trong build được giữ, bản publish đã bị thay thế bị xoá khi lần publish
    gần nhất của build đó cũ hơn `retention`.
    """
    if retention < _SHORTEST_RETENTION:
        raise ValueError("The retention must be at least one day: a browser may still be loading what was replaced")
    if keep < 0:
        raise ValueError("The number of old builds to keep cannot be negative")
    root = root or builds_root()
    removed = {"publications": 0, "builds": 0}
    if not root.is_dir():
        return removed
    before = now - retention

    for dataset in session.scalars(select(DatasetDef).order_by(DatasetDef.id)).all():
        builds = session.execute(
            select(Build, Job.status)
            .outerjoin(Job, Job.id == Build.job_id)
            .where(Build.dataset_id == dataset.id)
            .order_by(Build.id.desc())
        ).all()
        current = next((build for build, _ in builds if build.is_current), None)
        others = [(build, job_status) for build, job_status in builds if not build.is_current]
        # Build vừa bị thay thế chưa bị xoá ngay: người đang mở cây cũ còn tải các cột của nó.
        settled = current is None or (current.published_at is not None and current.published_at < before)

        staying = [build for build, _ in others[:keep]]
        if current is not None:
            staying.append(current)
        for build, job_status in others[keep:]:
            if settled and build.created_at < before and job_status not in _UNFINISHED:
                removed["builds"] += _remove_build(session, root, dataset, build.id)
            else:
                staying.append(build)

        for build in staying:
            if build.published_at is None or build.published_at >= before:
                continue
            for folder in _replaced_publications(root, dataset, build):
                shutil.rmtree(folder, ignore_errors=True)
                removed["publications"] += not folder.exists()
    return removed
