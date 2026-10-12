import datetime as dt
from collections import Counter

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.build.datasets import seed_datasets
from app.build.selection import select_samples
from app.models import Build, DatasetDef, Sample, SampleAlignment
from tests.support import add_sample


def add_genome(
    session, country: str, year: int | None, *, lineage="denv1", valid_nt=10_500, status="aligned"
) -> Sample:
    dates = {"date_min": dt.date(year, 1, 1), "date_max": dt.date(year, 12, 31)} if year else {}
    sample = add_sample(session, country=country, **dates)
    session.add(
        SampleAlignment(
            sample_id=sample.id,
            lineage=lineage,
            status=status,
            aligned_sequence="ACGT" if status == "aligned" else None,
            valid_nt=valid_nt if status == "aligned" else None,
            sequence_sha256="0" * 64,
            tool="nextclade 3.24.0",
        )
    )
    session.flush()
    return sample


def make_dataset(session, **fields) -> DatasetDef:
    defaults = {
        "slug": "dengue-denv1",
        "title": "Dengue virus 1",
        "pathogen": "dengue",
        "lineage": "denv1",
        "max_samples": 100,
        "min_context_share": 0.0,
    }
    dataset = DatasetDef(**(defaults | fields))
    session.add(dataset)
    session.flush()
    return dataset


def picked(session, dataset: DatasetDef) -> dict[int, str]:
    return {choice.sample_id: choice.role for choice in select_samples(session, dataset)}


def test_every_home_sample_is_taken_then_context_is_spread_over_country_and_year(session):
    home = [add_genome(session, "Vietnam", 2019) for _ in range(3)]
    context = {
        ("Thailand", 2019): [add_genome(session, "Thailand", 2019) for _ in range(5)],
        ("Brazil", 2019): [add_genome(session, "Brazil", 2019) for _ in range(5)],
        ("Brazil", 2020): [add_genome(session, "Brazil", 2020) for _ in range(5)],
    }

    chosen = picked(session, make_dataset(session, max_samples=9))

    per_group = {group: sum(1 for sample in samples if sample.id in chosen) for group, samples in context.items()}
    assert {sample.id for sample in home} <= set(chosen)
    assert Counter(chosen.values()) == {"home": 3, "context": 6}
    assert per_group == {("Thailand", 2019): 2, ("Brazil", 2019): 2, ("Brazil", 2020): 2}


def test_selection_is_the_same_every_time(session):
    for country in ("Thailand", "Brazil", "India"):
        for _ in range(6):
            add_genome(session, country, 2019)
    dataset = make_dataset(session, max_samples=7)

    assert picked(session, dataset) == picked(session, dataset)


def test_one_new_sample_changes_at_most_one_previous_choice(session):
    for country in ("Thailand", "Brazil", "India"):
        for year in (2018, 2019):
            for _ in range(8):
                add_genome(session, country, year)
    dataset = make_dataset(session, max_samples=12)
    before = set(picked(session, dataset))

    add_genome(session, "Thailand", 2019)
    after = set(picked(session, dataset))

    assert len(after) == 12
    assert len(before - after) <= 1


def test_only_dated_well_covered_aligned_genomes_of_the_lineage_are_eligible(session):
    good = add_genome(session, "Thailand", 2019)
    add_genome(session, "Thailand", None)
    add_genome(session, "Thailand", 2019, valid_nt=9_999)
    add_genome(session, "Thailand", 2019, status="failed")
    add_genome(session, "Thailand", 2019, lineage="denv2")
    add_sample(session, country="Thailand", date_min=dt.date(2019, 1, 1), date_max=dt.date(2019, 1, 1))

    assert picked(session, make_dataset(session)) == {good.id: "context"}


def test_home_samples_leave_room_for_the_minimum_share_of_context(session):
    home_2018 = [add_genome(session, "Vietnam", 2018) for _ in range(5)]
    home_2019 = [add_genome(session, "Vietnam", 2019) for _ in range(5)]
    for _ in range(5):
        add_genome(session, "Thailand", 2019)

    chosen = picked(session, make_dataset(session, max_samples=8, min_context_share=0.25))

    assert Counter(chosen.values()) == {"home": 6, "context": 2}
    # Khi phải bớt mẫu trong nước thì bớt đều theo năm.
    assert sum(1 for sample in home_2018 if sample.id in chosen) == 3
    assert sum(1 for sample in home_2019 if sample.id in chosen) == 3


def test_everything_is_taken_when_there_is_less_than_the_cap(session):
    add_genome(session, "Vietnam", 2019)
    add_genome(session, "Thailand", 2019)

    assert Counter(picked(session, make_dataset(session, max_samples=50)).values()) == {"home": 1, "context": 1}


def test_a_dataset_has_at_most_one_current_build(session):
    first = make_dataset(session)
    second = make_dataset(session, slug="dengue-denv2", lineage="denv2")
    session.add_all(
        [
            Build(dataset_id=first.id, status="succeeded", is_current=True),
            Build(dataset_id=first.id, status="succeeded", is_current=False),
            Build(dataset_id=second.id, status="succeeded", is_current=True),
        ]
    )
    session.flush()

    session.add(Build(dataset_id=first.id, status="succeeded", is_current=True))
    with pytest.raises(IntegrityError):
        session.flush()


def test_default_datasets_are_created_once_and_later_edits_are_kept(session):
    created_first = seed_datasets(session)
    denv1 = session.scalars(select(DatasetDef).filter_by(slug="dengue-denv1")).one()
    denv1.max_samples = 3000
    session.flush()

    created_again = seed_datasets(session)

    session.expire_all()
    slugs = sorted(session.scalars(select(DatasetDef.slug)))
    assert slugs == ["dengue-denv1", "dengue-denv2", "dengue-denv3", "dengue-denv4"]
    assert (denv1.lineage, denv1.home_country, denv1.max_samples) == ("denv1", "Vietnam", 3000)
    assert (created_first, created_again) == (4, 0)
