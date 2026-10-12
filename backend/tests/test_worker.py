import datetime as dt
import time
from contextlib import contextmanager

import pytest
from sqlalchemy import select, text

from app.jobs import queue
from app.jobs.steps import JobContext
from app.jobs.worker import Worker
from app.models import Job, JobStep


def make_worker(session, tmp_path, handlers, **options) -> Worker:
    @contextmanager
    def same_session():
        yield session

    # Không bật luồng báo nhịp: nó sẽ dùng chung session của test từ một luồng khác.
    options.setdefault("heartbeat_seconds", None)
    return Worker(same_session, handlers, name="test-worker", work_root=tmp_path, **options)


def test_the_worker_runs_the_handler_of_the_job_kind_and_stores_its_result(session, tmp_path):
    seen = {}

    def count(context: JobContext) -> dict:
        seen["params"] = context.params
        with context.step("count"):
            pass
        return {"counted": 3}

    job = queue.enqueue(session, "count", {"dataset": "denv1"})
    worker = make_worker(session, tmp_path, {"count": count})

    assert worker.run_one() is True

    session.expire_all()
    assert seen["params"] == {"dataset": "denv1"}
    assert (job.status, job.result, job.worker) == ("succeeded", {"counted": 3}, "test-worker")
    assert session.scalars(select(JobStep.name).filter_by(job_id=job.id)).all() == ["count"]


def test_a_handler_error_fails_that_job_and_the_worker_keeps_going(session, tmp_path):
    def explode(_context: JobContext) -> dict:
        raise RuntimeError("reference file is missing")

    broken = queue.enqueue(session, "explode")
    fine = queue.enqueue(session, "ok")
    worker = make_worker(session, tmp_path, {"explode": explode, "ok": lambda _context: {"ok": True}})

    assert [worker.run_one(), worker.run_one(), worker.run_one()] == [True, True, False]

    session.expire_all()
    assert (broken.status, fine.status) == ("failed", "succeeded")
    assert broken.error == "RuntimeError: reference file is missing"
    assert broken.finished_at is not None


def test_an_unknown_job_kind_fails_the_job(session, tmp_path):
    job = queue.enqueue(session, "mine_bitcoin")

    make_worker(session, tmp_path, {}).run_one()

    session.expire_all()
    assert job.status == "failed"
    assert "mine_bitcoin" in job.error


def test_each_job_gets_its_own_work_directory(session, tmp_path):
    directories = []
    for _ in range(2):
        queue.enqueue(session, "where")
    worker = make_worker(session, tmp_path, {"where": lambda context: directories.append(context.work_dir)})

    worker.run_one()
    worker.run_one()

    assert len(set(directories)) == 2
    assert all(directory.is_dir() and directory.parent == tmp_path for directory in directories)


def test_a_job_abandoned_by_a_dead_worker_is_failed_when_the_next_worker_looks_for_work(session, tmp_path):
    abandoned = queue.enqueue(session, "noop")
    queue.claim(session, "dead-worker")
    session.execute(text("UPDATE job SET heartbeat_at = now() - interval '10 minutes'"))

    make_worker(session, tmp_path, {}, stale_after=dt.timedelta(seconds=90)).run_one()

    session.expire_all()
    assert abandoned.status == "failed"


def test_a_long_job_keeps_reporting_that_it_is_alive(committed, tmp_path):
    beats = []

    def slow(context: JobContext) -> None:
        for _ in range(3):
            time.sleep(0.3)
            with committed() as observer:
                beats.append(observer.scalar(select(Job.heartbeat_at).filter_by(id=context.job.id)))

    with committed.begin() as session:
        queue.enqueue(session, "slow")
    worker = Worker(committed, {"slow": slow}, name="w", work_root=tmp_path, heartbeat_seconds=0.1)

    worker.run_one()

    assert beats[0] < beats[-1]


def test_run_forever_stops_when_asked(session, tmp_path):
    import threading

    stop = threading.Event()
    handled = []

    def handler(_context: JobContext) -> None:
        handled.append(1)
        stop.set()

    queue.enqueue(session, "once")
    worker = make_worker(session, tmp_path, {"once": handler})

    worker.run_forever(poll_seconds=0.01, stop=stop)

    assert handled == [1]


@pytest.mark.tools
def test_tool_versions_handler_reports_the_tools_of_the_worker_image(session, tmp_path):
    from app.jobs.handlers import HANDLERS

    job = queue.enqueue(session, "tool_versions")

    make_worker(session, tmp_path, HANDLERS).run_one()

    session.expire_all()
    assert job.status == "succeeded", job.error
    assert job.result["augur"].startswith("augur 34.")
    assert job.result["nextclade"].startswith("nextclade 3.")
    assert "IQ-TREE" in job.result["iqtree"]
