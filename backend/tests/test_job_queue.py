import datetime as dt
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.jobs import queue
from app.models import Job


def test_enqueue_creates_a_queued_job_with_its_parameters(session):
    job = queue.enqueue(session, "build_dataset", {"dataset": "denv1"}, priority=5)

    session.expire_all()
    stored = session.get(Job, job.id)
    assert (stored.kind, stored.params, stored.status, stored.priority) == (
        "build_dataset",
        {"dataset": "denv1"},
        "queued",
        5,
    )
    assert stored.created_at is not None
    assert (stored.started_at, stored.finished_at, stored.worker) == (None, None, None)


def test_claim_takes_the_highest_priority_then_the_oldest_job(session):
    old = queue.enqueue(session, "noop")
    urgent = queue.enqueue(session, "noop", priority=10)
    new = queue.enqueue(session, "noop")

    order = [queue.claim(session, "w1").id for _ in range(3)]

    assert order == [urgent.id, old.id, new.id]


def test_claim_marks_the_job_running_for_that_worker(session):
    queue.enqueue(session, "noop")

    job = queue.claim(session, "worker-a")

    session.expire_all()
    assert (job.status, job.worker) == ("running", "worker-a")
    assert job.started_at is not None and job.heartbeat_at is not None


def test_claim_returns_nothing_when_no_job_is_waiting(session):
    queue.enqueue(session, "noop")
    queue.claim(session, "w1")

    assert queue.claim(session, "w1") is None


def test_finish_records_success_and_the_result(session):
    queue.enqueue(session, "noop")
    job = queue.claim(session, "w1")

    queue.finish(session, job, {"tips": 30})

    session.expire_all()
    assert (job.status, job.result, job.error) == ("succeeded", {"tips": 30}, None)
    assert job.finished_at is not None


def test_fail_records_the_error(session):
    queue.enqueue(session, "noop")
    job = queue.claim(session, "w1")

    queue.fail(session, job, "iqtree exited with code 2")

    session.expire_all()
    assert (job.status, job.error) == ("failed", "iqtree exited with code 2")
    assert job.finished_at is not None


def test_a_running_job_whose_worker_stopped_reporting_is_failed(session):
    queue.enqueue(session, "noop")
    silent = queue.claim(session, "w1")
    queue.enqueue(session, "noop")
    alive = queue.claim(session, "w2")
    waiting = queue.enqueue(session, "noop")
    session.execute(
        text("UPDATE job SET heartbeat_at = now() - interval '5 minutes' WHERE id = :id"), {"id": silent.id}
    )

    failed = queue.fail_stale(session, dt.timedelta(seconds=90))

    session.expire_all()
    assert failed == 1
    assert (silent.status, alive.status, waiting.status) == ("failed", "running", "queued")
    assert "stopped reporting" in silent.error


def test_heartbeat_keeps_a_running_job_alive(session):
    queue.enqueue(session, "noop")
    job = queue.claim(session, "w1")
    session.execute(text("UPDATE job SET heartbeat_at = now() - interval '5 minutes' WHERE id = :id"), {"id": job.id})

    queue.heartbeat(session, job.id)

    assert queue.fail_stale(session, dt.timedelta(seconds=90)) == 0


def test_an_unknown_status_is_rejected(session):
    session.add(Job(kind="noop", status="paused"))

    with pytest.raises(IntegrityError):
        session.flush()


# Hai test dưới đây cần kết nối thật và dữ liệu đã commit (fixture `committed`).


def test_a_job_locked_by_one_worker_is_skipped_by_another_without_waiting(committed):
    with committed.begin() as session:
        first = queue.enqueue(session, "noop")
        second = queue.enqueue(session, "noop")

    with committed() as worker_a, committed() as worker_b:
        locked_id = queue.lock_next(worker_a).id  # worker A đang giữ khoá, chưa commit
        # Nếu thiếu SKIP LOCKED, lệnh dưới sẽ chờ khoá và bị PostgreSQL ngắt sau 2 giây.
        worker_b.execute(text("SET lock_timeout = '2s'"))
        claimed_id = queue.claim(worker_b, "worker-b").id
        worker_a.rollback()

    assert (locked_id, claimed_id) == (first.id, second.id)


def test_concurrent_workers_claim_every_job_exactly_once(committed):
    with committed.begin() as session:
        expected = {queue.enqueue(session, "noop").id for _ in range(20)}
    start = threading.Barrier(4)

    def drain(worker: str) -> list[int]:
        claimed = []
        with committed() as session:
            start.wait()
            while (job := queue.claim(session, worker)) is not None:
                claimed.append(job.id)
        return claimed

    with ThreadPoolExecutor(max_workers=4) as pool:
        claimed = [job_id for batch in pool.map(drain, ["w1", "w2", "w3", "w4"]) for job_id in batch]

    assert len(claimed) == 20
    assert set(claimed) == expected


def test_a_job_failed_by_the_sweep_is_not_revived_by_its_slow_worker(session):
    queue.enqueue(session, "noop")
    job = queue.claim(session, "slow-worker")
    session.execute(text("UPDATE job SET heartbeat_at = now() - interval '5 minutes' WHERE id = :id"), {"id": job.id})
    queue.fail_stale(session, dt.timedelta(seconds=90))

    recorded = queue.finish(session, job, {"tips": 30})

    session.expire_all()
    assert recorded is False
    assert (job.status, job.result) == ("failed", None)
    assert "stopped reporting" in job.error


def test_a_finished_job_cannot_be_failed_afterwards(session):
    queue.enqueue(session, "noop")
    job = queue.claim(session, "w1")
    assert queue.finish(session, job, {"ok": True}) is True

    assert queue.fail(session, job, "too late") is False

    session.expire_all()
    assert (job.status, job.error) == ("succeeded", None)


def test_an_error_text_with_nul_bytes_can_be_stored(session):
    queue.enqueue(session, "noop")
    job = queue.claim(session, "w1")

    queue.fail(session, job, "crashed\x00 with binary\x00 output")

    session.expire_all()
    assert job.error == "crashed with binary output"
