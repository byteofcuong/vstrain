import datetime as dt

import pytest

from app.samples.dates import parse_collection_date


@pytest.mark.parametrize(
    ("raw", "start", "end"),
    [
        ("2019-03-15", dt.date(2019, 3, 15), dt.date(2019, 3, 15)),
        ("2019-03-XX", dt.date(2019, 3, 1), dt.date(2019, 3, 31)),
        ("2019-XX-XX", dt.date(2019, 1, 1), dt.date(2019, 12, 31)),
        ("2019-03", dt.date(2019, 3, 1), dt.date(2019, 3, 31)),
        ("2019", dt.date(2019, 1, 1), dt.date(2019, 12, 31)),
        (" 2019-xx-xx ", dt.date(2019, 1, 1), dt.date(2019, 12, 31)),
    ],
)
def test_an_incomplete_date_becomes_the_range_it_could_mean(raw, start, end):
    assert parse_collection_date(raw) == (start, end)


def test_an_unknown_day_covers_february_of_a_leap_year():
    assert parse_collection_date("2020-02-XX").end == dt.date(2020, 2, 29)
    assert parse_collection_date("2019-02-XX").end == dt.date(2019, 2, 28)


@pytest.mark.parametrize("raw", [None, "", "   ", "XXXX-XX-XX", "XXXX"])
def test_an_unknown_year_means_no_date(raw):
    assert parse_collection_date(raw) is None


@pytest.mark.parametrize(
    "raw",
    [
        "2019-13-01",  # tháng không tồn tại
        "2019-02-30",  # ngày không tồn tại
        "2019-XX-15",  # biết ngày mà không biết tháng
        "XXXX-05-XX",  # biết tháng mà không biết năm
        "15/03/2019",
        "2019-3-5",
        "abc",
    ],
)
def test_a_malformed_date_is_an_error_not_a_missing_date(raw):
    with pytest.raises(ValueError):
        parse_collection_date(raw)
