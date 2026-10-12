import pytest
from sqlalchemy import select

from app.jobs import queue
from app.jobs.steps import JobContext
from app.jobs.tools import ToolFailed
from app.models import JobStep


@pytest.fixture
def context(session, tmp_path) -> JobContext:
    queue.enqueue(session, "noop", {"dataset": "denv1"})
    job = queue.claim(session, "w1")
    return JobContext(session=session, job=job, work_dir=tmp_path, allowed_tools=frozenset({"python3"}))


def steps(session) -> list[JobStep]:
    session.expire_all()
    return list(session.scalars(select(JobStep).order_by(JobStep.position)))


def test_a_step_is_visible_as_running_while_it_runs_and_succeeded_after(session, context):
    with context.step("prepare") as step:
        during = [(row.name, row.status, row.finished_at) for row in steps(session)]
        step.metrics["samples"] = 30

    (row,) = steps(session)
    assert during == [("prepare", "running", None)]
    assert (row.name, row.status, row.position) == ("prepare", "succeeded", 1)
    assert row.finished_at is not None
    assert row.metrics["samples"] == 30
    assert row.metrics["wall_seconds"] >= 0


def test_a_failing_step_is_recorded_with_the_error_and_the_error_propagates(session, context):
    with pytest.raises(RuntimeError, match="no samples selected"), context.step("prepare"):
        raise RuntimeError("no samples selected")

    (row,) = steps(session)
    assert (row.status, row.finished_at is not None) == ("failed", True)
    assert "no samples selected" in row.log_tail


def test_steps_are_numbered_in_the_order_they_run(session, context):
    for name in ("prepare", "tree", "refine"):
        with context.step(name):
            pass

    assert [(row.position, row.name) for row in steps(session)] == [(1, "prepare"), (2, "tree"), (3, "refine")]


def test_running_a_tool_is_one_step_with_its_measurements_and_log(session, context):
    result = context.run_tool("tree", ["python3", "-c", "print('tree built')"], timeout=20)

    (row,) = steps(session)
    assert result.exit_code == 0
    assert (row.name, row.status) == ("tree", "succeeded")
    assert set(row.metrics) >= {"wall_seconds", "cpu_seconds", "max_rss_mb"}
    assert "tree built" in row.log_tail
    assert (context.work_dir / "01-tree.log").read_text().strip() == "tree built"


def test_a_failing_tool_leaves_the_end_of_its_log_in_the_step(session, context):
    with pytest.raises(ToolFailed):
        context.run_tool("tree", ["python3", "-c", "import sys; print('out of memory'); sys.exit(1)"], timeout=20)

    (row,) = steps(session)
    assert row.status == "failed"
    assert "out of memory" in row.log_tail


def test_a_tool_outside_the_allowlist_fails_the_step(session, context):
    with pytest.raises(Exception, match="allowlist"):
        context.run_tool("tree", ["touch", "x"], timeout=20)

    assert [row.status for row in steps(session)] == ["failed"]
    assert not (context.work_dir / "x").exists()
