"""Dọn bản publish đã bị thay thế và build cũ."""

import datetime as dt
import logging
import shutil
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.accounts import service as accounts
from app.build import prune
from app.build.prune import prune_builds
from app.build.publish import build_folder
from app.config import Settings, settings
from app.jobs import queue
from app.jobs.worker import _housekeeping
from app.models import AuditLog, Build, BuildSample, DatasetDef
from tests.support import add_sample

NOW = dt.datetime(2026, 10, 14, 12, 0, tzinfo=dt.UTC)
WEEK = dt.timedelta(days=7)
FIRST = "p-" + "a" * 12
SECOND = "p-" + "b" * 12
THIRD = "p-" + "c" * 12


def days_ago(days: float) -> dt.datetime:
    return NOW - dt.timedelta(days=days)


def make_dataset(session, slug: str = "dengue-denv1") -> DatasetDef:
    dataset = DatasetDef(slug=slug, title=f"Dengue {slug}", pathogen="dengue", lineage="denv1", max_samples=2000)
    session.add(dataset)
    session.flush()
    return dataset


def make_build(
    session,
    root: Path,
    dataset: DatasetDef,
    *,
    created: float,
    published: float | None = None,
    current: bool = False,
    publications: tuple[str, ...] = (FIRST,),
) -> Build:
    """Một build tạo cách đây `created` ngày. Có `published` thì nó có thư mục, cây, và các bản publish theo thứ tự
    được tạo; dòng build trỏ tới bản cuối. Không có thì nó là một build dở dang: chỉ có dòng trong database."""
    build = Build(dataset_id=dataset.id, is_current=current, sample_count=1, created_at=days_ago(created))
    session.add(build)
    session.flush()
    if published is not None:
        folder = root / build_folder(dataset, build)
        folder.mkdir(parents=True)
        (folder / "auspice.json").write_text("{}")
        for name in publications:
            (folder / name).mkdir()
            (folder / name / "manifest.json").write_text("{}")
            (folder / name / "tree.json").write_text("{}")
        build.path = f"{build_folder(dataset, build)}/{publications[-1]}"
        build.published_at = days_ago(published)
        session.flush()
    return build


def folder_of(root: Path, dataset: DatasetDef, build: Build) -> Path:
    return root / build_folder(dataset, build)


def names(folder: Path) -> list[str]:
    return sorted(entry.name for entry in folder.iterdir())


def run(session, root: Path, *, keep: int = 5, retention: dt.timedelta = WEEK) -> dict[str, int]:
    return prune_builds(session, now=NOW, retention=retention, keep=keep, root=root)


def build_ids(session) -> list[int]:
    return list(session.scalars(select(Build.id).order_by(Build.id)))


# --- Bản publish đã bị thay thế ---


def test_publications_that_were_replaced_long_ago_are_removed_and_the_one_in_use_stays(session, tmp_path):
    dataset = make_dataset(session)
    build = make_build(
        session, tmp_path, dataset, created=60, published=8, current=True, publications=(FIRST, SECOND, THIRD)
    )

    assert run(session, tmp_path) == {"publications": 2, "builds": 0}

    assert names(folder_of(tmp_path, dataset, build)) == ["auspice.json", THIRD]
    assert names(folder_of(tmp_path, dataset, build) / THIRD) == ["manifest.json", "tree.json"]
    session.expire_all()
    assert (build.path, build.is_current) == (f"dengue-denv1/b{build.id:06d}/{THIRD}", True)


def test_publications_replaced_only_recently_are_kept_however_old_they_are(session, tmp_path):
    # Bản cũ được tạo từ hai tháng trước nhưng mới bị thay hôm qua: trình duyệt đang mở nó còn cần các file của nó.
    dataset = make_dataset(session)
    build = make_build(session, tmp_path, dataset, created=60, published=1, current=True, publications=(FIRST, SECOND))
    edge = make_build(
        session,
        tmp_path,
        make_dataset(session, "dengue-denv2"),
        created=60,
        published=6.9,
        current=True,
        publications=(FIRST, SECOND),
    )

    assert run(session, tmp_path) == {"publications": 0, "builds": 0}

    assert names(folder_of(tmp_path, dataset, build)) == ["auspice.json", FIRST, SECOND]
    assert SECOND in names(tmp_path / "dengue-denv2" / f"b{edge.id:06d}")


def test_only_real_publication_folders_inside_the_build_are_touched(session, tmp_path):
    dataset = make_dataset(session)
    build = make_build(session, tmp_path, dataset, created=60, published=30, current=True, publications=(FIRST, SECOND))
    folder = folder_of(tmp_path, dataset, build)
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (outside / "keep.txt").write_text("not ours")
    linked = "p-" + "d" * 12
    (folder / linked).symlink_to(outside, target_is_directory=True)
    (folder / ("p-" + "e" * 12)).write_text("a file, not a folder")
    (folder / "p-notahash").mkdir()
    (folder / ("p-" + "A" * 12)).mkdir()
    (folder / "notes").mkdir()

    assert run(session, tmp_path) == {"publications": 1, "builds": 0}

    assert names(folder) == sorted(
        ["auspice.json", SECOND, linked, "p-" + "e" * 12, "p-notahash", "p-" + "A" * 12, "notes"]
    )
    assert (outside / "keep.txt").read_text() == "not ours"


def test_a_build_whose_path_points_outside_its_own_folder_is_left_alone(session, tmp_path):
    dataset = make_dataset(session)
    build = make_build(session, tmp_path, dataset, created=60, published=30, current=True, publications=(FIRST, SECOND))
    build.path = f"dengue-denv1/b999999/{SECOND}"
    session.flush()

    assert run(session, tmp_path) == {"publications": 0, "builds": 0}

    assert names(folder_of(tmp_path, dataset, build)) == ["auspice.json", FIRST, SECOND]


# --- Build cũ ---


def test_old_builds_beyond_the_ones_kept_are_removed_with_their_files_and_their_rows(session, tmp_path):
    dataset = make_dataset(session)
    oldest = make_build(session, tmp_path, dataset, created=50, published=50)
    sample = add_sample(session)
    session.add(BuildSample(build_id=oldest.id, sample_id=sample.id, role="home"))
    broken = make_build(session, tmp_path, dataset, created=45)  # dở dang: không có thư mục nào
    older = make_build(session, tmp_path, dataset, created=40, published=40)
    kept = make_build(session, tmp_path, dataset, created=30, published=30)
    current = make_build(session, tmp_path, dataset, created=20, published=20, current=True)
    newer_failure = make_build(session, tmp_path, dataset, created=10)
    session.flush()

    assert run(session, tmp_path, keep=2) == {"publications": 0, "builds": 3}

    assert build_ids(session) == [kept.id, current.id, newer_failure.id]
    assert names(tmp_path / "dengue-denv1") == [f"b{kept.id:06d}", f"b{current.id:06d}"]
    assert session.scalar(select(func.count()).select_from(BuildSample)) == 0
    # Mẫu thì còn: chỉ việc "mẫu này từng nằm trong build đó" bị xoá.
    assert session.get(type(sample), sample.id) is not None
    del oldest, broken, older


def test_keeping_no_old_build_still_keeps_the_current_one(session, tmp_path):
    dataset = make_dataset(session)
    old = make_build(session, tmp_path, dataset, created=90, published=90)
    current = make_build(session, tmp_path, dataset, created=80, published=80, current=True)

    assert run(session, tmp_path, keep=0) == {"publications": 0, "builds": 1}

    assert build_ids(session) == [current.id]
    assert names(folder_of(tmp_path, dataset, current)) == ["auspice.json", FIRST]
    del old


def test_builds_of_one_dataset_do_not_count_against_another(session, tmp_path):
    first = make_dataset(session, "dengue-denv1")
    second = make_dataset(session, "dengue-denv2")
    mine = [make_build(session, tmp_path, first, created=40 - index, published=40 - index) for index in range(3)]
    theirs = [make_build(session, tmp_path, second, created=40 - index, published=40 - index) for index in range(3)]

    assert run(session, tmp_path, keep=2) == {"publications": 0, "builds": 2}

    assert build_ids(session) == [mine[1].id, mine[2].id, theirs[1].id, theirs[2].id]


def test_a_build_is_not_removed_while_it_is_recent_or_its_dataset_just_changed_trees(session, tmp_path):
    # Build vừa bị thay thế hôm qua: người đang mở cây cũ còn cần file của nó, dù nó được tạo từ lâu.
    replaced = make_dataset(session, "dengue-denv1")
    just_replaced = make_build(session, tmp_path, replaced, created=40, published=40)
    make_build(session, tmp_path, replaced, created=1, published=1, current=True)
    # Build mới tạo, nằm ngoài số được giữ, trong một dataset không có build hiện hành.
    young = make_dataset(session, "dengue-denv2")
    recent = make_build(session, tmp_path, young, created=3, published=3)
    make_build(session, tmp_path, young, created=2)

    assert run(session, tmp_path, keep=0) == {"publications": 0, "builds": 0}

    assert just_replaced.id in build_ids(session) and recent.id in build_ids(session)
    assert folder_of(tmp_path, replaced, just_replaced).is_dir()


def test_a_build_whose_job_has_not_ended_is_not_removed(session, tmp_path):
    dataset = make_dataset(session)
    waiting = make_build(session, tmp_path, dataset, created=30)
    running = make_build(session, tmp_path, dataset, created=29)
    ended = make_build(session, tmp_path, dataset, created=28)
    waiting.job_id = queue.enqueue(session, "build_dataset", {"dataset": "dengue-denv1"}).id
    job = queue.enqueue(session, "build_dataset", {"dataset": "dengue-denv1"})
    job.status = "running"
    running.job_id = job.id
    done = queue.enqueue(session, "build_dataset", {"dataset": "dengue-denv1"})
    done.status = "cancelled"
    ended.job_id = done.id
    session.flush()

    assert run(session, tmp_path, keep=0) == {"publications": 0, "builds": 1}

    assert build_ids(session) == [waiting.id, running.id]


def test_a_build_folder_that_cannot_be_removed_keeps_its_row_for_the_next_round(session, tmp_path, monkeypatch, caplog):
    dataset = make_dataset(session)
    stuck = make_build(session, tmp_path, dataset, created=50, published=50)
    fine = make_build(session, tmp_path, dataset, created=49, published=49)
    stuck_folder = folder_of(tmp_path, dataset, stuck)
    real_rmtree = shutil.rmtree

    def rmtree(path, *args, **kwargs):
        if Path(path) == stuck_folder:
            raise OSError("Device or resource busy")
        return real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(prune.shutil, "rmtree", rmtree)

    with caplog.at_level(logging.WARNING):
        assert run(session, tmp_path, keep=0) == {"publications": 0, "builds": 1}

    assert build_ids(session) == [stuck.id]
    assert stuck_folder.is_dir() and not folder_of(tmp_path, dataset, fine).exists()
    assert f"build {stuck.id}" in caplog.text

    monkeypatch.undo()
    assert run(session, tmp_path, keep=0) == {"publications": 0, "builds": 1}
    assert build_ids(session) == []


def test_a_build_folder_that_is_a_link_is_not_followed_and_its_row_stays(session, tmp_path):
    dataset = make_dataset(session)
    build = make_build(session, tmp_path, dataset, created=50)
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (outside / "keep.txt").write_text("not ours")
    (tmp_path / "dengue-denv1").mkdir()
    folder_of(tmp_path, dataset, build).symlink_to(outside, target_is_directory=True)

    assert run(session, tmp_path, keep=0) == {"publications": 0, "builds": 0}

    assert build_ids(session) == [build.id]
    assert (outside / "keep.txt").read_text() == "not ours"


def test_nothing_outside_the_folders_of_known_builds_is_removed(session, tmp_path):
    dataset = make_dataset(session)
    make_build(session, tmp_path, dataset, created=50, published=50)
    stranger = tmp_path / "dengue-denv1" / "b999999"
    stranger.mkdir()
    (tmp_path / "other-dataset" / "b000001" / FIRST).mkdir(parents=True)
    (tmp_path / "dengue-denv1" / ".tmp-123").mkdir()

    assert run(session, tmp_path, keep=0) == {"publications": 0, "builds": 1}

    assert names(tmp_path / "dengue-denv1") == [".tmp-123", "b999999"]
    assert (tmp_path / "other-dataset" / "b000001" / FIRST).is_dir()


def test_nothing_is_removed_when_the_builds_folder_is_not_there(session, tmp_path):
    # Thư mục dữ liệu không được gắn (cấu hình sai, volume chưa lên): "thư mục của build không có" lúc này không có
    # nghĩa là build đã mất file, nên không dòng nào được xoá.
    dataset = make_dataset(session)
    old = make_build(session, tmp_path / "elsewhere", dataset, created=50, published=50)
    unfinished = make_build(session, tmp_path / "elsewhere", dataset, created=40)

    assert prune_builds(session, now=NOW, retention=WEEK, keep=0, root=tmp_path / "missing") == {
        "publications": 0,
        "builds": 0,
    }

    assert build_ids(session) == [old.id, unfinished.id]


@pytest.mark.parametrize(
    ("retention", "keep"),
    [(dt.timedelta(0), 5), (dt.timedelta(hours=23), 5), (dt.timedelta(days=-3), 5), (WEEK, -1)],
)
def test_settings_that_would_remove_what_is_still_in_use_are_refused(session, tmp_path, retention, keep):
    dataset = make_dataset(session)
    build = make_build(
        session, tmp_path, dataset, created=60, published=0.01, current=True, publications=(FIRST, SECOND)
    )

    with pytest.raises(ValueError, match="retention|keep"):
        prune_builds(session, now=NOW, retention=retention, keep=keep, root=tmp_path)

    assert names(folder_of(tmp_path, dataset, build)) == ["auspice.json", FIRST, SECOND]


def test_the_configuration_refuses_the_same_settings():
    with pytest.raises(ValueError):
        Settings(publication_retention_days=0)
    with pytest.raises(ValueError):
        Settings(keep_builds=-1)
    assert (Settings().publication_retention_days, Settings().keep_builds) == (7, 5)
    assert Settings(keep_builds=0).keep_builds == 0


# --- Worker ---


def test_the_housekeeping_of_the_general_worker_prunes_builds_along_with_sessions_and_audit_rows(
    session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    root = tmp_path / "builds"
    dataset = make_dataset(session)
    now = dt.datetime.now(dt.UTC)
    old = Build(dataset_id=dataset.id, sample_count=1, created_at=now - dt.timedelta(days=40))
    current = Build(dataset_id=dataset.id, sample_count=1, created_at=now - dt.timedelta(days=30), is_current=True)
    session.add_all([old, current])
    session.flush()
    for build in (old, current):
        folder = root / build_folder(dataset, build)
        (folder / FIRST).mkdir(parents=True)
        build.path = f"{build_folder(dataset, build)}/{FIRST}"
        build.published_at = build.created_at
    accounts.record(session, None, "login_failed")
    session.execute(AuditLog.__table__.update().values(at=now - dt.timedelta(days=400)))
    session.flush()

    chore = _housekeeping(
        audit_retention=dt.timedelta(days=365), publication_retention=dt.timedelta(days=7), keep_builds=0
    )
    chore(session)

    assert build_ids(session) == [current.id]
    assert names(root / "dengue-denv1") == [f"b{current.id:06d}"]
    assert session.scalar(select(func.count()).select_from(AuditLog)) == 0
