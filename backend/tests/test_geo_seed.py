import datetime as dt
from collections import Counter

import pytest
from sqlalchemy import select

from app.geo.normalize import place_key
from app.geo.seed import AliasCandidate, AliasConflict, alias_rows, seed_geo
from app.models import AdminUnit, PlaceAlias


def units(session, **filters) -> list[AdminUnit]:
    return list(session.scalars(select(AdminUnit).filter_by(**filters)))


def test_seed_loads_both_province_sets_and_the_regions(session):
    seed_geo(session)

    assert len(units(session, unit_set="vn63")) == 63
    assert len(units(session, unit_set="vn34")) == 34
    assert len(units(session, level="macro_region")) == 3
    assert len(units(session, level="region")) == 6


def test_old_provinces_end_the_day_before_the_new_units_start(session):
    seed_geo(session)

    assert {unit.valid_to for unit in units(session, unit_set="vn63")} == {dt.date(2025, 6, 30)}
    assert {unit.valid_from for unit in units(session, unit_set="vn34")} == {dt.date(2025, 7, 1)}


def test_every_old_province_has_one_successor_and_the_counts_match_the_resolution(session):
    seed_geo(session)
    new_codes = {unit.code for unit in units(session, unit_set="vn34")}

    successors = [unit.successor_code for unit in units(session, unit_set="vn63")]
    predecessors = Counter(successors)

    assert set(successors) == new_codes
    # Nghị quyết 202/2025/QH15: 11 đơn vị giữ nguyên, 52 đơn vị cũ gộp thành 23 đơn vị mới.
    assert sum(1 for count in predecessors.values() if count == 1) == 11
    assert sum(1 for count in predecessors.values() if count > 1) == 23
    assert sum(count for count in predecessors.values() if count > 1) == 52


def test_known_mergers_point_to_the_right_successor(session):
    seed_geo(session)

    successor = {unit.code: unit.successor_code for unit in units(session, unit_set="vn63")}

    assert successor["vn63:binh-dinh"] == "vn34:gia-lai"
    assert successor["vn63:kon-tum"] == "vn34:quang-ngai"
    assert successor["vn63:ba-ria-vung-tau"] == "vn34:ho-chi-minh"
    assert successor["vn63:ha-noi"] == "vn34:ha-noi"


def test_every_old_province_sits_in_a_region_and_every_region_in_a_macro_region(session):
    seed_geo(session)
    macro_regions = {unit.code for unit in units(session, level="macro_region")}

    provinces_per_region = Counter(unit.parent_code for unit in units(session, unit_set="vn63"))

    assert provinces_per_region == {
        "vnr:red-river-delta": 11,
        "vnr:northern-midlands-and-mountains": 14,
        "vnr:north-central-and-central-coast": 14,
        "vnr:central-highlands": 5,
        "vnr:southeast": 6,
        "vnr:mekong-delta": 13,
    }
    assert {unit.parent_code for unit in units(session, level="region")} == macro_regions


def test_every_new_unit_keeps_the_name_of_an_old_province(session):
    # Bộ phân giải dựa vào điều này: tên nào cũng tra ra tỉnh bộ 63 trước, rồi mới theo ngày sang bộ 34.
    seed_geo(session)

    old_names = {unit.name_vi for unit in units(session, unit_set="vn63")}

    assert {unit.name_vi for unit in units(session, unit_set="vn34")} <= old_names


def test_names_other_spellings_cities_and_regions_become_aliases(session):
    seed_geo(session)

    def alias(text: str) -> tuple[str, str]:
        row = session.get(PlaceAlias, place_key(text))
        return row.unit_code, row.kind

    assert alias("Đắk Lắk") == ("vn63:dak-lak", "name")
    assert alias("Dac Lac") == ("vn63:dak-lak", "variant")
    assert alias("Saigon") == ("vn63:ho-chi-minh", "variant")
    assert alias("Nha Trang") == ("vn63:khanh-hoa", "city")
    assert alias("Red River Delta") == ("vnr:red-river-delta", "name")
    assert alias("South") == ("vnm:south", "variant")


def test_seeding_twice_changes_nothing(session):
    def snapshot() -> tuple[list[tuple], list[tuple]]:
        session.expire_all()
        unit_rows = [(u.code, u.name_vi, u.parent_code, u.successor_code, u.valid_to) for u in units(session)]
        alias_list = [(a.key, a.unit_code, a.kind) for a in session.scalars(select(PlaceAlias))]
        return sorted(unit_rows, key=repr), sorted(alias_list)

    seed_geo(session)
    first = snapshot()
    seed_geo(session)

    assert snapshot() == first


def test_seeding_again_keeps_aliases_added_by_an_admin(session):
    seed_geo(session)
    session.add(PlaceAlias(key="bmt", unit_code="vn63:dak-lak", kind="variant", source="admin", example="BMT"))
    session.flush()

    seed_geo(session)

    assert session.get(PlaceAlias, "bmt").source == "admin"


def test_two_spellings_with_one_key_for_different_units_are_reported():
    candidates = [
        AliasCandidate("Hòa Bình", "vn63:hoa-binh", "name"),
        AliasCandidate("Hoa Binh", "vn63:thai-binh", "variant"),
    ]

    with pytest.raises(AliasConflict) as error:
        alias_rows(candidates)

    message = str(error.value)
    assert "Hòa Bình" in message and "Hoa Binh" in message
    assert "vn63:hoa-binh" in message and "vn63:thai-binh" in message


def test_two_spellings_with_one_key_for_the_same_unit_give_one_alias():
    rows = alias_rows(
        [AliasCandidate("Đắk Lắk", "vn63:dak-lak", "name"), AliasCandidate("Dak Lak", "vn63:dak-lak", "variant")]
    )

    assert [(row["key"], row["kind"], row["example"]) for row in rows] == [("daklak", "name", "Đắk Lắk")]


def test_a_spelling_without_letters_is_reported():
    with pytest.raises(ValueError, match="không có chữ"):
        alias_rows([AliasCandidate("--", "vn63:dak-lak", "variant")])
