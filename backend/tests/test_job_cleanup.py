import datetime as dt
import threading
from pathlib import Path

from sqlalchemy import text

from app.jobs import queue
from app.jobs.cleanup import purge_work_dirs
from tests.test_worker import make_worker

WEEK = dt.timedelta(days=7)


def job_with_folder(session, root: Path, status: str, finished_days_ago: int | None) -> Path:
    job = queue.enqueue(session, "anything")
    session.execute(text("UPDATE job SET status = :status WHERE id = :id"), {"status": status, "id": job.id})
    if finished_days_ago is not None:
        session.execute(
            text("UPDATE job SET finished_at = now() - make_interval(days => :days) WHERE id = :id"),
            {"days": finished_days_ago, "id": job.id},
        )
    folder = root / f"job-{job.id}"
    folder.mkdir()
    (folder / "tree.log").write_text("log")
    return folder


def test_work_directories_of_jobs_that_finished_long_ago_are_removed(session, tmp_path):
    old_success = job_with_folder(session, tmp_path, "succeeded", 10)
    old_failure = job_with_folder(session, tmp_path, "failed", 8)

    assert purge_work_dirs(session, tmp_path, WEEK) == 2

    assert not old_success.exists() and not old_failure.exists()


def test_recent_and_unfinished_jobs_keep_their_work_directory(session, tmp_path):
    recent = job_with_folder(session, tmp_path, "failed", 2)
    running = job_with_folder(session, tmp_path, "running", None)
    queued = job_with_folder(session, tmp_path, "queued", None)

    assert purge_work_dirs(session, tmp_path, WEEK) == 0

    assert recent.is_dir() and running.is_dir() and queued.is_dir()


def test_only_real_job_folders_inside_the_work_root_are_touched(session, tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    old = job_with_folder(session, work, "succeeded", 30)
    job_id = int(old.name.removeprefix("job-"))
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.txt").write_text("keep")
    # Những thứ không phải thư mục làm việc của một job đã biết: không được đụng tới.
    old.rename(work / "saved")
    (work / f"job-{job_id}").symlink_to(outside, target_is_directory=True)
    for name in ("notes", "job-abc", f"job-{job_id}-copy", "job-99999999", "job-" + "9" * 40):
        (work / name).mkdir()

    assert purge_work_dirs(session, work, WEEK) == 0

    assert (outside / "keep.txt").read_text() == "keep"
    assert sorted(entry.name for entry in work.iterdir()) == sorted(
        ["saved", f"job-{job_id}", "notes", "job-abc", f"job-{job_id}-copy", "job-99999999", "job-" + "9" * 40]
    )


def test_a_missing_work_root_is_not_an_error(session, tmp_path):
    assert purge_work_dirs(session, tmp_path / "never-created", WEEK) == 0


def test_an_idle_worker_purges_old_work_directories(session, tmp_path):
    old = job_with_folder(session, tmp_path, "succeeded", 10)
    recent = job_with_folder(session, tmp_path, "succeeded", 1)
    stop = threading.Event()
    worker = make_worker(session, tmp_path, {}, work_retention=WEEK)

    threading.Timer(0.3, stop.set).start()
    worker.run_forever(poll_seconds=0.01, stop=stop)

    assert not old.exists() and recent.is_dir()


def test_a_worker_without_a_retention_period_removes_nothing(session, tmp_path):
    old = job_with_folder(session, tmp_path, "succeeded", 10)
    stop = threading.Event()
    worker = make_worker(session, tmp_path, {})

    threading.Timer(0.2, stop.set).start()
    worker.run_forever(poll_seconds=0.01, stop=stop)

    assert old.is_dir()


def test_the_work_directory_of_a_cancelled_job_is_removed_like_any_other_that_ended(session, tmp_path):
    old = job_with_folder(session, tmp_path, "cancelled", 9)
    recent = job_with_folder(session, tmp_path, "cancelled", 1)

    assert purge_work_dirs(session, tmp_path, WEEK) == 1

    assert not old.exists() and recent.is_dir()
