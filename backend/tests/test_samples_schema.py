import datetime as dt
import re

import pytest
from sqlalchemy.exc import IntegrityError

from app.geo.seed import seed_geo
from app.models import Sample, SampleSequence


def make_sample(**fields) -> Sample:
    defaults = {
        "display_name": "DENV1/Vietnam/2019/x",
        "pathogen": "dengue",
        "source": "genbank",
        "geo_status": "missing",
    }
    return Sample(**(defaults | fields))


def saved(session, sample: Sample) -> Sample:
    session.add(sample)
    session.flush()
    session.refresh(sample)
    return sample


def test_every_sample_gets_an_ascii_internal_id_derived_from_its_number(session):
    first = saved(session, make_sample(display_name="Hà_Nội/01/2024"))
    second = saved(session, make_sample(display_name="Hà_Nội/01/2024"))

    assert re.fullmatch(r"S\d{7}", first.internal_id)
    assert first.internal_id == f"S{first.id:07d}"
    assert first.internal_id != second.internal_id


def test_the_internal_id_is_not_cut_when_the_number_outgrows_seven_digits(session):
    sample = saved(session, make_sample(id=12_345_678))

    assert sample.internal_id == "S12345678"


def test_an_accession_can_be_used_by_one_sample_only(session):
    saved(session, make_sample(accession="MN018344"))
    session.add(make_sample(accession="MN018344"))

    with pytest.raises(IntegrityError):
        session.flush()


def test_the_raw_place_text_is_kept_next_to_the_resolved_unit(session):
    seed_geo(session)
    sample = saved(
        session,
        make_sample(
            country="Vietnam",
            division_raw=" Daklak ",
            location_raw="Buôn  Ma Thuột",
            admin_unit_code="vn63:dak-lak",
            region_code="vnr:central-highlands",
            geo_status="province",
        ),
    )
    session.expire_all()

    stored = session.get(Sample, sample.id)

    assert (stored.division_raw, stored.location_raw) == (" Daklak ", "Buôn  Ma Thuột")
    assert (stored.admin_unit_code, stored.region_code) == ("vn63:dak-lak", "vnr:central-highlands")


def test_an_incomplete_date_is_stored_as_its_raw_text_and_a_range(session):
    sample = saved(
        session,
        make_sample(collection_date_raw="2019-XX-XX", date_min=dt.date(2019, 1, 1), date_max=dt.date(2019, 12, 31)),
    )

    assert (sample.collection_date_raw, sample.date_min, sample.date_max) == (
        "2019-XX-XX",
        dt.date(2019, 1, 1),
        dt.date(2019, 12, 31),
    )


@pytest.mark.parametrize(
    ("date_min", "date_max"),
    [(dt.date(2019, 1, 1), None), (None, dt.date(2019, 1, 1)), (dt.date(2019, 12, 31), dt.date(2019, 1, 1))],
)
def test_a_half_open_or_reversed_date_range_is_rejected(session, date_min, date_max):
    session.add(make_sample(date_min=date_min, date_max=date_max))

    with pytest.raises(IntegrityError):
        session.flush()


def test_an_unknown_geo_status_is_rejected(session):
    session.add(make_sample(geo_status="somewhere"))

    with pytest.raises(IntegrityError):
        session.flush()


def test_a_sample_must_point_to_an_existing_unit(session):
    session.add(make_sample(admin_unit_code="vn63:khong-co", geo_status="province"))

    with pytest.raises(IntegrityError):
        session.flush()


def test_a_sample_has_at_most_one_sequence_and_it_goes_away_with_the_sample(session):
    sample = saved(session, make_sample())
    session.add(SampleSequence(sample_id=sample.id, sequence="ACGT", length=4, sha256="0" * 64))
    session.flush()

    session.delete(sample)
    session.flush()
    session.expire_all()

    assert session.get(SampleSequence, sample.id) is None
