import datetime as dt

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.models import AdminUnit, PlaceAlias


def province(code: str, name: str, **fields) -> AdminUnit:
    return AdminUnit(code=code, level="province", unit_set=code.split(":")[0], name_vi=name, name_en=name, **fields)


def test_admin_unit_has_the_columns_the_geo_module_needs(engine):
    columns = {column["name"] for column in inspect(engine).get_columns("admin_unit")}

    assert columns == {
        "code",
        "level",
        "unit_set",
        "name_vi",
        "name_en",
        "parent_code",
        "successor_code",
        "valid_from",
        "valid_to",
    }


def test_a_province_can_end_on_a_date_and_point_to_its_successor(session):
    session.add(province("vn34:gia-lai", "Gia Lai", valid_from=dt.date(2025, 7, 1)))
    session.flush()
    session.add(province("vn63:binh-dinh", "Bình Định", valid_to=dt.date(2025, 6, 30), successor_code="vn34:gia-lai"))
    session.flush()
    session.expire_all()

    old = session.get(AdminUnit, "vn63:binh-dinh")

    assert (old.valid_to, old.successor_code) == (dt.date(2025, 6, 30), "vn34:gia-lai")


def test_an_alias_must_point_to_an_existing_unit(session):
    session.add(PlaceAlias(key="nhatrang", unit_code="vn63:khong-co", kind="city", source="seed", example="Nha Trang"))

    with pytest.raises(IntegrityError):
        session.flush()


def test_a_successor_must_be_an_existing_unit(session):
    session.add(province("vn63:binh-dinh", "Bình Định", successor_code="vn34:khong-co"))

    with pytest.raises(IntegrityError):
        session.flush()


def test_an_unknown_level_is_rejected(session):
    session.add(AdminUnit(code="vn:x", level="district", unit_set="vn63", name_vi="X", name_en="X"))

    with pytest.raises(IntegrityError):
        session.flush()


def test_a_province_must_belong_to_a_unit_set(session):
    session.add(AdminUnit(code="vn63:x", level="province", unit_set=None, name_vi="X", name_en="X"))

    with pytest.raises(IntegrityError):
        session.flush()


def test_a_region_must_not_belong_to_a_unit_set(session):
    session.add(AdminUnit(code="vnr:x", level="region", unit_set="vn63", name_vi="X", name_en="X"))

    with pytest.raises(IntegrityError):
        session.flush()
