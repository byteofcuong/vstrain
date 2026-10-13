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


def test_a_result_that_cannot_be_stored_fails_the_job_and_the_worker_keeps_going(session, tmp_path):
    broken = queue.enqueue(session, "bad_result")
    fine = queue.enqueue(session, "ok")
    handlers = {"bad_result": lambda _context: {"value": object()}, "ok": lambda _context: {"ok": True}}
    worker = make_worker(session, tmp_path, handlers)

    assert [worker.run_one(), worker.run_one()] == [True, True]

    session.expire_all()
    assert (broken.status, fine.status) == ("failed", "succeeded")
    assert broken.error


def test_run_forever_survives_an_error_outside_any_handler(session, tmp_path):
    import threading

    from sqlalchemy.exc import OperationalError

    stop = threading.Event()
    calls = {"count": 0}

    @contextmanager
    def flaky_sessions():
        calls["count"] += 1
        if calls["count"] == 1:
            raise OperationalError("SELECT 1", {}, ConnectionRefusedError("database restarting"))
        yield session

    job = queue.enqueue(session, "once")
    worker = Worker(
        flaky_sessions, {"once": lambda _context: stop.set()}, name="w", work_root=tmp_path, heartbeat_seconds=None
    )

    worker.run_forever(poll_seconds=0.01, stop=stop)

    session.expire_all()
    assert calls["count"] >= 2
    assert job.status == "succeeded"


def test_a_job_with_an_unknown_parameter_is_rejected(session, tmp_path):
    from app.jobs.handlers import HANDLERS

    jobs = [
        queue.enqueue(session, "build_dataset", {"dataset": "dengue-denv1", "tree_builder_args": "; touch pwned"}),
        queue.enqueue(session, "align_pending", {"lineage": "denv1", "nextclade_args": "--x"}),
        queue.enqueue(session, "publish_build", {"build_id": 1, "root": "/etc"}),
        queue.enqueue(session, "tool_versions", {"tool": "sh"}),
    ]
    worker = make_worker(session, tmp_path, HANDLERS)

    for _ in jobs:
        worker.run_one()

    session.expire_all()
    assert [job.status for job in jobs] == ["failed"] * 4
    assert "tree_builder_args" in jobs[0].error and "Unknown job parameter" in jobs[0].error
    assert not list(tmp_path.rglob("pwned"))


def test_a_worker_limited_to_some_kinds_does_not_touch_the_others(session, tmp_path):
    ran = []
    handlers = {"quick": lambda _context: ran.append("quick"), "slow": lambda _context: ran.append("slow")}
    slow = queue.enqueue(session, "slow", priority=5)
    queue.enqueue(session, "quick")
    worker = make_worker(session, tmp_path, handlers, kinds=frozenset({"quick"}))

    assert [worker.run_one(), worker.run_one()] == [True, False]

    session.refresh(slow)
    assert (ran, slow.status) == (["quick"], "queued")


def test_the_kinds_a_worker_is_limited_to_must_be_ones_it_can_run():
    from app.jobs.worker import selected_kinds

    handlers = {"quick": None, "slow": None}

    assert selected_kinds(None, handlers) is None
    assert selected_kinds(["quick"], handlers) == frozenset({"quick"})
    with pytest.raises(ValueError, match="no-such-kind"):
        selected_kinds(["quick", "no-such-kind"], handlers)


# --- Việc định kỳ: xét lịch build và dọn dẹp ---


def test_the_worker_checks_the_schedule_between_jobs_and_runs_what_it_queued(session, tmp_path):
    import threading

    stop = threading.Event()
    ran = []

    def schedule(session) -> None:
        # Lịch chỉ xếp một lần, như khi tới hạn; job nó xếp phải được commit thì worker mới lấy được.
        if not ran and not session.scalars(select(Job)).all():
            queue.enqueue(session, "build")

    def build(_context: JobContext) -> None:
        ran.append("build")
        stop.set()

    worker = make_worker(session, tmp_path, {"build": build}, schedule=schedule, schedule_seconds=0)

    worker.run_forever(poll_seconds=0.01, stop=stop)

    assert ran == ["build"]


def test_the_schedule_is_checked_no_more_often_than_asked(session, tmp_path):
    import threading

    stop = threading.Event()
    checks = []
    worker = make_worker(session, tmp_path, {}, schedule=lambda _session: checks.append(1), schedule_seconds=3600)

    threading.Timer(0.2, stop.set).start()
    worker.run_forever(poll_seconds=0.01, stop=stop)

    assert checks == [1]


def test_a_schedule_check_that_breaks_does_not_stop_the_worker(session, tmp_path):
    import threading

    stop = threading.Event()

    def broken(_session) -> None:
        raise RuntimeError("selection failed")

    job = queue.enqueue(session, "once")
    worker = make_worker(session, tmp_path, {"once": lambda _context: stop.set()}, schedule=broken, schedule_seconds=0)

    worker.run_forever(poll_seconds=0.01, stop=stop)

    session.expire_all()
    assert job.status == "succeeded"


def test_an_idle_worker_does_its_housekeeping_and_keeps_what_it_changed(session, tmp_path):
    import threading

    stop = threading.Event()
    done = []

    def housekeeping(session) -> None:
        done.append(1)
        queue.enqueue(session, "marker")
        stop.set()

    worker = make_worker(session, tmp_path, {}, housekeeping=housekeeping, kinds=frozenset({"nothing"}))

    worker.run_forever(poll_seconds=0.01, stop=stop)
    session.rollback()  # thứ việc dọn dẹp đã ghi phải được commit, không mất khi session bị huỷ

    assert done == [1]
    assert [job.kind for job in session.scalars(select(Job))] == ["marker"]


def test_only_a_worker_that_builds_trees_checks_the_build_schedule():
    from app.jobs.worker import builds_trees

    assert builds_trees(None)
    assert builds_trees(frozenset({"build_dataset", "place_pending"}))
    assert not builds_trees(frozenset({"ingest_sample"}))
