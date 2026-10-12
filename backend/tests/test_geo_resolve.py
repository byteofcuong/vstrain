import csv
import datetime as dt
from pathlib import Path

import pytest

from app.geo.resolve import GeoStatus, PlaceResolver
from app.geo.seed import OLD_SET, seed_geo, unit_code

FIXTURES = Path(__file__).parent / "fixtures"

BEFORE_MERGER = dt.date(2010, 5, 1)
AFTER_MERGER = dt.date(2025, 7, 1)


@pytest.fixture
def resolver(session) -> PlaceResolver:
    seed_geo(session)
    return PlaceResolver.load(session)


def resolve(resolver: PlaceResolver, division=None, location=None, day: dt.date | None = BEFORE_MERGER):
    return resolver.resolve(division=division, location=location, date_min=day, date_max=day)


def test_a_city_resolves_to_its_province_and_region(resolver):
    place = resolve(resolver, division="Nha Trang")

    assert place.status is GeoStatus.PROVINCE
    assert place.unit_code == "vn63:khanh-hoa"
    assert place.region_code == "vnr:north-central-and-central-coast"
    assert place.matched == "Nha Trang"


@pytest.mark.parametrize(
    ("division", "region_code"),
    [("South", "vnm:south"), ("Northern Vietnam", "vnm:north"), ("Mekong Delta", "vnr:mekong-delta")],
)
def test_a_region_name_resolves_to_the_region_without_a_province(resolver, division, region_code):
    place = resolve(resolver, division=division)

    assert (place.status, place.unit_code, place.region_code) == (GeoStatus.REGION, None, region_code)


def test_a_province_in_location_wins_over_a_region_in_division(resolver):
    place = resolve(resolver, division="Red River Delta", location="Hanoi")

    assert (place.status, place.unit_code, place.matched) == (GeoStatus.PROVINCE, "vn63:ha-noi", "Hanoi")
    assert place.region_code == "vnr:red-river-delta"


def test_a_province_in_division_wins_over_a_region_in_location(resolver):
    place = resolve(resolver, division="Dak Lak", location="Central Vietnam")

    assert (place.status, place.unit_code) == (GeoStatus.PROVINCE, "vn63:dak-lak")


def test_a_region_wins_over_a_macro_region(resolver):
    place = resolve(resolver, division="Mekong Delta", location="South")

    assert place.region_code == "vnr:mekong-delta"


def test_location_wins_when_both_fields_name_a_province(resolver):
    place = resolve(resolver, division="Hai Phong", location="Hanoi")

    assert place.unit_code == "vn63:ha-noi"


def test_a_sample_collected_before_the_merger_gets_the_old_province(resolver):
    place = resolve(resolver, division="Binh Dinh", day=dt.date(2025, 6, 30))

    assert place.unit_code == "vn63:binh-dinh"


def test_a_sample_collected_after_the_merger_gets_the_successor_unit(resolver):
    place = resolve(resolver, division="Binh Dinh", day=AFTER_MERGER)

    assert (place.status, place.unit_code) == (GeoStatus.PROVINCE, "vn34:gia-lai")


def test_a_name_kept_by_the_new_unit_means_the_larger_unit_after_the_merger(resolver):
    # "Gia Lai" năm 2026 có thể là vùng Bình Định cũ, nên không được gán về tỉnh Gia Lai cũ.
    assert resolve(resolver, division="Gia Lai", day=BEFORE_MERGER).unit_code == "vn63:gia-lai"
    assert resolve(resolver, division="Gia Lai", day=dt.date(2026, 3, 1)).unit_code == "vn34:gia-lai"


def test_a_date_range_reaching_past_the_merger_gets_the_successor_unit(resolver):
    # "2025-XX-XX": không biết trước hay sau 1/7/2025, đơn vị kế thừa chứa cả hai khả năng.
    place = resolver.resolve(division="Binh Dinh", date_min=dt.date(2025, 1, 1), date_max=dt.date(2025, 12, 31))

    assert place.unit_code == "vn34:gia-lai"


def test_an_unknown_date_gets_the_successor_unit(resolver):
    place = resolve(resolver, division="Binh Dinh", day=None)

    assert place.unit_code == "vn34:gia-lai"


def test_the_region_is_that_of_the_assigned_unit(resolver):
    # Đơn vị bộ 34 chưa được gán vùng (xem NGUON.md), nên mẫu sau sáp nhập chưa có vùng.
    assert resolve(resolver, division="Binh Dinh").region_code == "vnr:north-central-and-central-coast"
    assert resolve(resolver, division="Binh Dinh", day=AFTER_MERGER).region_code is None


@pytest.mark.parametrize(("division", "location"), [(None, None), ("", "   "), ("?", "-")])
def test_no_text_means_missing(resolver, division, location):
    place = resolve(resolver, division=division, location=location)

    assert (place.status, place.unit_code, place.region_code, place.matched) == (GeoStatus.MISSING, None, None, None)


def test_text_that_matches_nothing_is_unresolved(resolver):
    place = resolve(resolver, division="Atlantis")

    assert (place.status, place.unit_code, place.region_code, place.matched) == (GeoStatus.UNRESOLVED, None, None, None)


def test_an_unknown_location_does_not_hide_a_known_division(resolver):
    place = resolve(resolver, division="South", location="Atlantis")

    assert (place.status, place.region_code) == (GeoStatus.REGION, "vnm:south")


def test_at_least_95_percent_of_331_province_spellings_resolve_to_the_right_province(resolver):
    # 331 cách viết này là đầu vào của phép đo V1 trên `augur curate apply-geolocation-rules` (tiêu chí 4c).
    with (FIXTURES / "province_spellings.tsv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))

    wrong = [
        row
        for row in rows
        if resolve(resolver, division=row["spelling"]).unit_code != unit_code(OLD_SET, row["province"])
    ]

    assert len(rows) == 331
    assert len(wrong) <= 0.05 * len(rows), wrong
