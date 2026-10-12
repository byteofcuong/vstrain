import json
import time
from pathlib import Path

import pytest

from app.jobs.tools import ToolFailed, ToolNotAllowed, ToolTimeout, run_tool

# Test dùng python3 làm "công cụ" để điều khiển được hành vi; danh sách cho phép thật nằm trong app.jobs.tools.
TEST_TOOLS = frozenset({"python3"})

ECHO_ARGUMENTS = "import json, sys; print(json.dumps(sys.argv[1:]))"


def run(tmp_path: Path, *argv: str, **options):
    options.setdefault("timeout", 20)
    return run_tool(list(argv), cwd=tmp_path, log_path=tmp_path / "tool.log", allowed=TEST_TOOLS, **options)


def is_running(pid: int) -> bool:
    try:
        state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
    except FileNotFoundError:
        return False
    return state not in ("Z", "X")  # tiến trình đã chết nhưng chưa được thu dọn không còn chạy


def test_arguments_reach_the_tool_verbatim_and_no_shell_interprets_them(tmp_path):
    hostile = ["; touch pwned1", "$(touch pwned2)", "`touch pwned3`", "a b", "*", "&& touch pwned4", "Hà_Nội/01/2024"]

    result = run(tmp_path, "python3", "-c", ECHO_ARGUMENTS, *hostile)

    assert json.loads(result.log_tail) == hostile
    assert sorted(path.name for path in tmp_path.iterdir()) == ["tool.log"]


@pytest.mark.parametrize("tool", ["touch", "sh", "/usr/local/bin/python3", "./python3", "python3 -c pass", ""])
def test_a_tool_outside_the_allowlist_is_refused_before_anything_runs(tmp_path, tool):
    with pytest.raises(ToolNotAllowed):
        run(tmp_path, tool, "created")

    assert list(tmp_path.iterdir()) == []


def test_an_empty_command_is_refused(tmp_path):
    with pytest.raises(ToolNotAllowed):
        run_tool([], cwd=tmp_path, log_path=tmp_path / "tool.log", timeout=5, allowed=TEST_TOOLS)


def test_a_nonzero_exit_raises_with_the_exit_code_and_the_end_of_the_log(tmp_path):
    with pytest.raises(ToolFailed) as error:
        run(tmp_path, "python3", "-c", "import sys; print('before'); sys.stderr.write('boom\\n'); sys.exit(3)")

    assert error.value.exit_code == 3
    assert "boom" in error.value.log_tail
    assert "before" in (tmp_path / "tool.log").read_text()


def test_a_tool_that_runs_too_long_is_killed_together_with_its_children(tmp_path):
    spawn_child = (
        "import pathlib, subprocess, time\n"
        "child = subprocess.Popen(['sleep', '60'])\n"
        "pathlib.Path('child.pid').write_text(str(child.pid))\n"
        "time.sleep(60)\n"
    )
    started = time.monotonic()

    with pytest.raises(ToolTimeout):
        run(tmp_path, "python3", "-c", spawn_child, timeout=1.5)

    child_pid = int((tmp_path / "child.pid").read_text())
    time.sleep(0.2)
    assert time.monotonic() - started < 10
    assert not is_running(child_pid)


def test_the_result_reports_wall_time_cpu_time_and_peak_memory(tmp_path):
    burn = "data = bytearray(60 * 1024 * 1024)\ntotal = 0\nfor i in range(3_000_000):\n    total += i\n"

    result = run(tmp_path, "python3", "-c", burn)

    assert result.exit_code == 0
    assert result.wall_seconds > 0.05
    assert 0.05 < result.cpu_seconds < result.wall_seconds + 1
    assert result.max_rss_mb > 60


def test_the_child_sees_a_minimal_environment_without_the_database_url(tmp_path, monkeypatch):
    monkeypatch.setenv("VS_DATABASE_URL", "postgresql://user:secret@db/vietstrain")
    dump = "import json, os; print(json.dumps(dict(os.environ)))"

    result = run(tmp_path, "python3", "-c", dump, env={"AUGUR_RECURSION_LIMIT": "100000"})

    environment = json.loads(result.log_tail)
    assert "VS_DATABASE_URL" not in environment
    assert "secret" not in result.log_tail
    assert environment["AUGUR_RECURSION_LIMIT"] == "100000"
    assert "PATH" in environment


def test_the_tool_runs_in_the_given_directory(tmp_path):
    result = run(tmp_path, "python3", "-c", "import os; print(os.getcwd())")

    assert result.log_tail.strip() == str(tmp_path)


def test_an_argument_with_a_nul_byte_is_refused(tmp_path):
    with pytest.raises(ValueError):
        run(tmp_path, "python3", "-c", "pass", "bad\0argument")


def test_only_the_end_of_a_long_log_is_returned(tmp_path):
    result = run(tmp_path, "python3", "-c", "print('x' * 100_000); print('the end')")

    assert len(result.log_tail) <= 4000
    assert result.log_tail.rstrip().endswith("the end")
    assert (tmp_path / "tool.log").stat().st_size > 100_000
