import datetime as dt
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select, text

from app import cli
from app.build.inputs import start_build
from app.build.selection import Choice, inputs_hash, select_samples
from app.jobs import queue, schedule
from app.jobs.schedule import BuildAlreadyWaiting, enqueue_due_builds, request_build
from app.models import Build, DatasetDef, Job, SampleAlignment
from tests.test_build_selection import add_genome, make_dataset

NOW = dt.datetime(2026, 10, 13, 12, 0, tzinfo=dt.UTC)


def hours_ago(hours: float) -> dt.datetime:
    return NOW - dt.timedelta(hours=hours)


def scheduled(session, hours: int | None = 24, **fields) -> DatasetDef:
    return make_dataset(session, build_interval_hours=hours, **fields)


def build_jobs(session) -> list[Job]:
    return list(session.scalars(select(Job).where(Job.kind == "build_dataset").order_by(Job.id)))


def current_hash(session, dataset: DatasetDef) -> str:
    return inputs_hash(session, select_samples(session, dataset))


def past_build(
    session, dataset: DatasetDef, *, started: dt.datetime, inputs: str | None, published: bool = True
) -> Build:
    """Một lần build đã kết thúc: xong và đang là build hiện hành, hoặc hỏng (không có bản publish)."""
    job = Job(
        kind="build_dataset",
        params={"dataset": dataset.slug},
        status="succeeded" if published else "failed",
        created_at=started,
    )
    session.add(job)
    session.flush()
    build = Build(
        dataset_id=dataset.id,
        job_id=job.id,
        is_current=published,
        path=f"{dataset.slug}/b{job.id:06d}/p-000000000000" if published else None,
        inputs_hash=inputs,
        created_at=started,
    )
    session.add(build)
    session.flush()
    return build


# --- Hash của đầu vào ---


def test_the_inputs_hash_follows_which_samples_are_chosen_their_dates_and_their_sequences(session):
    dataset = make_dataset(session)
    first, second = add_genome(session, "Vietnam", 2019), add_genome(session, "Vietnam", 2020)
    choices = select_samples(session, dataset)
    before = inputs_hash(session, choices)

    # Thứ tự chọn không làm đổi hash; cùng dữ liệu cho cùng hash.
    assert inputs_hash(session, list(reversed(choices))) == before
    assert len(before) == 64

    first.date_max = dt.date(2019, 6, 30)
    session.flush()
    after_date = current_hash(session, dataset)
    session.get(SampleAlignment, second.id).sequence_sha256 = "1" * 64
    session.flush()
    after_sequence = current_hash(session, dataset)
    add_genome(session, "Vietnam", 2021)
    after_sample = current_hash(session, dataset)

    assert len({before, after_date, after_sequence, after_sample}) == 4


def test_two_samples_that_look_alike_still_give_different_hashes(session):
    # Trong một ổ dịch, nhiều mẫu có cùng ngày lấy mẫu và cùng chuỗi. Thay mẫu này bằng mẫu kia vẫn là một cây khác:
    # tip mang mã khác, và tỉnh của nó có thể khác.
    one, other = add_genome(session, "Vietnam", 2019), add_genome(session, "Vietnam", 2019)

    assert inputs_hash(session, [Choice(one.id, "home")]) != inputs_hash(session, [Choice(other.id, "home")])
    # Vai trò của mẫu trong build cũng là đầu vào.
    assert inputs_hash(session, [Choice(one.id, "home")]) != inputs_hash(session, [Choice(one.id, "context")])


def test_a_build_records_the_hash_of_what_it_was_built_from(session):
    dataset = make_dataset(session)
    add_genome(session, "Vietnam", 2019)
    job = queue.enqueue(session, "build_dataset", {"dataset": dataset.slug})

    build = start_build(session, dataset, job.id)

    assert build.inputs_hash == current_hash(session, dataset)


# --- Xét lịch ---


def test_a_scheduled_dataset_that_was_never_built_gets_a_build_once_it_has_samples(session):
    dataset = scheduled(session)
    assert enqueue_due_builds(session, NOW) == []

    add_genome(session, "Vietnam", 2019)
    queued = enqueue_due_builds(session, NOW)

    (job,) = build_jobs(session)
    assert queued == [job.id]
    assert (job.status, job.params, job.priority) == ("queued", {"dataset": dataset.slug}, 0)


def test_a_dataset_without_a_schedule_is_never_built_on_its_own(session):
    scheduled(session, hours=None)
    add_genome(session, "Vietnam", 2019)

    assert enqueue_due_builds(session, NOW) == []
    assert build_jobs(session) == []


def test_nothing_is_queued_before_the_interval_has_passed(session):
    dataset = scheduled(session, hours=24)
    add_genome(session, "Vietnam", 2019)
    build = past_build(session, dataset, started=hours_ago(23.9), inputs="0" * 64)

    assert enqueue_due_builds(session, NOW) == []

    # Đủ 24 giờ kể từ lúc lần build trước bắt đầu.
    build.created_at = hours_ago(24)
    session.get(Job, build.job_id).created_at = hours_ago(24)
    session.flush()
    assert len(enqueue_due_builds(session, NOW)) == 1


def test_nothing_is_queued_while_the_tree_would_be_built_from_the_same_samples(session):
    dataset = scheduled(session)
    kept = add_genome(session, "Vietnam", 2019)
    removed = add_genome(session, "Vietnam", 2020)
    build = past_build(session, dataset, started=hours_ago(240), inputs=current_hash(session, dataset))

    assert enqueue_due_builds(session, NOW) == []

    def due_after(change) -> bool:
        change()
        session.flush()
        queued = enqueue_due_builds(session, NOW)
        # Coi như lần build đó đã xong từ lâu với đúng đầu vào mới, để xét thay đổi kế tiếp.
        for job in build_jobs(session):
            job.status, job.created_at = "succeeded", hours_ago(240)
        build.inputs_hash = current_hash(session, dataset)
        session.flush()
        return bool(queued)

    # Một mẫu mới, một mẫu bị ẩn, một ngày lấy mẫu được sửa: cây sẽ khác, nên phải dựng lại.
    assert due_after(lambda: add_genome(session, "Thailand", 2019))
    assert due_after(lambda: setattr(removed, "status", "hidden"))
    assert due_after(lambda: setattr(kept, "date_max", dt.date(2019, 3, 1)))
    # Đổi tỉnh của một mẫu chỉ đổi cột thuộc tính của bản publish, không đổi cây.
    assert not due_after(lambda: setattr(kept, "division_raw", "Hà Nội"))


@pytest.mark.parametrize("status", ["queued", "running"])
def test_a_build_that_is_waiting_or_running_is_not_doubled(session, status):
    dataset = scheduled(session)
    other = scheduled(session, slug="dengue-denv2", lineage="denv2")
    add_genome(session, "Vietnam", 2019)
    add_genome(session, "Vietnam", 2019, lineage="denv2")
    waiting = queue.enqueue(session, "build_dataset", {"dataset": dataset.slug})
    # Job đã chờ từ lâu (hàng đợi nghẽn): hạn đã qua, nên chỉ còn việc nó chưa xong là thứ cản lần build mới.
    waiting.status, waiting.created_at = status, hours_ago(240)
    session.flush()

    queued = enqueue_due_builds(session, NOW)

    # Job đang chờ của một dataset không cản dataset khác.
    assert [session.get(Job, job_id).params for job_id in queued] == [{"dataset": other.slug}]


def test_other_kinds_of_job_on_the_same_dataset_neither_block_a_build_nor_count_as_one(session):
    dataset = scheduled(session)
    add_genome(session, "Vietnam", 2019)
    # Sau mỗi build có một job gắn lại mẫu tạm mang cùng tham số `dataset`; nó có thể đang chờ, hoặc vừa chạy xong.
    queue.enqueue(session, "place_pending", {"dataset": dataset.slug})
    done = queue.enqueue(session, "place_pending", {"dataset": dataset.slug})
    done.status = "succeeded"
    session.flush()

    assert len(enqueue_due_builds(session, NOW)) == 1


def test_a_build_whose_job_is_gone_still_starts_the_interval(session):
    dataset = scheduled(session, hours=24)
    add_genome(session, "Vietnam", 2019)
    build = past_build(session, dataset, started=hours_ago(1), inputs="0" * 64)
    session.delete(session.get(Job, build.job_id))
    session.flush()

    assert enqueue_due_builds(session, NOW) == []


def test_a_build_that_failed_is_tried_again_at_the_next_interval(session):
    dataset = scheduled(session, hours=24)
    add_genome(session, "Vietnam", 2019)
    same = current_hash(session, dataset)
    past_build(session, dataset, started=hours_ago(72), inputs="0" * 64)
    past_build(session, dataset, started=hours_ago(25), inputs=same, published=False)

    # Lần gần nhất hỏng: build hiện hành vẫn là cây cũ, dựng từ đầu vào khác.
    assert len(enqueue_due_builds(session, NOW)) == 1


def test_a_job_that_failed_before_it_chose_samples_still_starts_the_interval(session):
    dataset = scheduled(session, hours=24)
    add_genome(session, "Vietnam", 2019)
    failed = queue.enqueue(session, "build_dataset", {"dataset": dataset.slug})
    failed.status, failed.created_at = "failed", hours_ago(1)
    session.flush()

    # Không có dòng build nào, nhưng vừa thử cách đây một giờ: không thử lại mỗi phút.
    assert enqueue_due_builds(session, NOW) == []

    failed.created_at = hours_ago(24)
    session.flush()
    assert len(enqueue_due_builds(session, NOW)) == 1


# --- Dựng ngay ---


def test_a_build_asked_for_by_hand_ignores_the_schedule_but_not_a_build_already_waiting(session):
    dataset = scheduled(session, hours=None)
    add_genome(session, "Vietnam", 2019)
    past_build(session, dataset, started=hours_ago(0.1), inputs=current_hash(session, dataset))

    job = request_build(session, dataset.slug)

    assert (job.kind, job.status, job.params) == ("build_dataset", "queued", {"dataset": dataset.slug})
    with pytest.raises(BuildAlreadyWaiting):
        request_build(session, dataset.slug)
    with pytest.raises(LookupError):
        request_build(session, "no-such-dataset")
    assert len([job for job in build_jobs(session) if job.status == "queued"]) == 1


def test_the_enqueue_command_cannot_double_a_build_either(session):
    # Lệnh `python -m app.cli enqueue` là đường xếp job có từ trước khi có lịch; nó phải qua cùng một cửa.
    dataset = scheduled(session, hours=None)

    first = cli.enqueue_job(session, "build_dataset", {"dataset": dataset.slug}, priority=5)

    assert (first.params, first.priority, first.status) == ({"dataset": dataset.slug}, 5, "queued")
    with pytest.raises(BuildAlreadyWaiting):
        cli.enqueue_job(session, "build_dataset", {"dataset": dataset.slug}, priority=0)
    for params in ({"dataset": "no-such-dataset"}, {}, {"dataset": 7}):
        with pytest.raises(LookupError):
            cli.enqueue_job(session, "build_dataset", params, priority=0)
    assert len(build_jobs(session)) == 1
    other = cli.enqueue_job(session, "tool_versions", {"note": "x"}, priority=3)
    assert (other.kind, other.params, other.priority) == ("tool_versions", {"note": "x"}, 3)


def test_two_workers_checking_the_schedule_at_once_queue_one_build(committed, engine, monkeypatch):
    with committed.begin() as session:
        dataset = scheduled(session, slug="dengue-denv1-twice")
        add_genome(session, "Vietnam", 2019)
        slug = dataset.slug
    start = threading.Barrier(4)

    def slow_selection(session, dataset):
        # Giữ mọi bên ở giữa việc xét, sau khi đã thấy "chưa có job nào" và trước khi xếp job: không có khoá dòng
        # của dataset thì cả bốn bên cùng xếp.
        time.sleep(0.3)
        return select_samples(session, dataset)

    monkeypatch.setattr(schedule, "select_samples", slow_selection)

    def check(_: int) -> list[int]:
        with committed() as session:
            start.wait()
            queued = enqueue_due_builds(session, NOW)
            session.commit()
            return queued

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            queued = [job_id for batch in pool.map(check, range(4)) for job_id in batch]
        with committed() as session:
            stored = build_jobs(session)

        assert len(queued) == 1
        assert [(job.id, job.params) for job in stored] == [(queued[0], {"dataset": slug})]
    finally:
        with engine.begin() as connection:
            connection.execute(text("TRUNCATE dataset_def, sample CASCADE"))
