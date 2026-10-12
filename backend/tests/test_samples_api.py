import datetime as dt

import pytest

from app.geo.seed import seed_geo
from app.models import SampleSequence
from tests.support import add_sample


@pytest.fixture(autouse=True)
def geography(session):
    seed_geo(session)


def day(text: str) -> dict[str, dt.date]:
    date = dt.date.fromisoformat(text)
    return {"date_min": date, "date_max": date}


def names(response) -> list[str]:
    return [item["displayName"] for item in response.json()["items"]]


def in_unit(code: str, **fields) -> dict:
    regions = {"vn63:binh-dinh": "vnr:north-central-and-central-coast", "vn63:gia-lai": "vnr:central-highlands"}
    return {"admin_unit_code": code, "region_code": regions.get(code), "geo_status": "province"} | fields


def test_list_returns_samples_newest_first_with_the_total(session, client):
    add_sample(session, display_name="old", **day("2010-05-01"))
    add_sample(session, display_name="new", **day("2022-03-09"))
    add_sample(session, display_name="undated")

    response = client.get("/api/samples")

    body = response.json()
    assert response.status_code == 200
    assert names(response) == ["new", "old", "undated"]
    assert (body["total"], body["limit"], body["offset"]) == (3, 50, 0)


def test_list_items_describe_the_sample_in_camel_case(session, client):
    sample = add_sample(
        session,
        display_name="Hà_Nội/01/2018",
        collection_date_raw="2018-01-XX",
        date_min=dt.date(2018, 1, 1),
        date_max=dt.date(2018, 1, 31),
        division_raw="Red River Delta",
        location_raw="Hanoi",
        admin_unit_code="vn63:ha-noi",
        region_code="vnr:red-river-delta",
        geo_status="province",
        host="Homo sapiens",
    )
    session.add(SampleSequence(sample_id=sample.id, sequence="ACGT", length=4, sha256="0" * 64))
    session.flush()

    item = client.get("/api/samples").json()["items"][0]

    assert item == {
        "internalId": sample.internal_id,
        "displayName": "Hà_Nội/01/2018",
        "accession": sample.accession,
        "pathogen": "dengue",
        "source": "genbank",
        "collectionDate": "2018-01-XX",
        "dateMin": "2018-01-01",
        "dateMax": "2018-01-31",
        "country": "Vietnam",
        "division": "Red River Delta",
        "location": "Hanoi",
        "unitCode": "vn63:ha-noi",
        "regionCode": "vnr:red-river-delta",
        "geoStatus": "province",
        "host": "Homo sapiens",
        "sequenceLength": 4,
    }


def test_filter_by_an_old_province_returns_only_its_samples(session, client):
    add_sample(session, display_name="binh dinh", **in_unit("vn63:binh-dinh"))
    add_sample(session, display_name="gia lai", **in_unit("vn63:gia-lai"))

    response = client.get("/api/samples", params={"unit": "vn63:binh-dinh"})

    assert names(response) == ["binh dinh"]
    assert response.json()["total"] == 1


def test_filter_by_a_merged_unit_includes_the_provinces_merged_into_it(session, client):
    add_sample(session, display_name="binh dinh 2010", **in_unit("vn63:binh-dinh"), **day("2010-01-01"))
    add_sample(session, display_name="gia lai 2012", **in_unit("vn63:gia-lai"), **day("2012-01-01"))
    add_sample(session, display_name="gia lai 2026", **in_unit("vn34:gia-lai"), **day("2026-01-01"))
    add_sample(session, display_name="ha noi", **in_unit("vn63:ha-noi"))

    response = client.get("/api/samples", params={"unit": "vn34:gia-lai"})

    assert names(response) == ["gia lai 2026", "gia lai 2012", "binh dinh 2010"]


def test_filter_by_a_region_includes_its_provinces_and_region_only_samples(session, client):
    add_sample(session, display_name="gia lai", **in_unit("vn63:gia-lai"), **day("2012-01-01"))
    add_sample(
        session, display_name="highlands", region_code="vnr:central-highlands", geo_status="region", **day("2011-01-01")
    )
    add_sample(session, display_name="binh dinh", **in_unit("vn63:binh-dinh"))

    response = client.get("/api/samples", params={"unit": "vnr:central-highlands"})

    assert names(response) == ["gia lai", "highlands"]


def test_filter_by_a_macro_region_includes_its_regions(session, client):
    add_sample(session, display_name="south", region_code="vnm:south", geo_status="region", **day("2013-01-01"))
    add_sample(session, display_name="mekong", region_code="vnr:mekong-delta", geo_status="region", **day("2012-01-01"))
    add_sample(session, display_name="north", region_code="vnm:north", geo_status="region")

    response = client.get("/api/samples", params={"unit": "vnm:south"})

    assert names(response) == ["south", "mekong"]


def test_date_filter_keeps_samples_certainly_collected_inside_the_window(session, client):
    add_sample(session, display_name="15 March", **day("2019-03-15"))
    add_sample(session, display_name="some day in 2019", date_min=dt.date(2019, 1, 1), date_max=dt.date(2019, 12, 31))
    add_sample(session, display_name="April", **day("2019-04-01"))
    add_sample(session, display_name="undated")

    march = client.get("/api/samples", params={"dateFrom": "2019-03-01", "dateTo": "2019-03-31"})
    year = client.get("/api/samples", params={"dateFrom": "2019-01-01", "dateTo": "2019-12-31"})
    since_april = client.get("/api/samples", params={"dateFrom": "2019-04-01"})

    assert names(march) == ["15 March"]
    # Thứ tự theo ngày muộn nhất mà mẫu có thể được lấy, nên mẫu chỉ biết năm 2019 đứng trước.
    assert names(year) == ["some day in 2019", "April", "15 March"]
    assert names(since_april) == ["April"]


def test_unit_and_date_filters_combine(session, client):
    add_sample(session, display_name="wanted", **in_unit("vn63:binh-dinh"), **day("2019-03-15"))
    add_sample(session, display_name="other year", **in_unit("vn63:binh-dinh"), **day("2010-03-15"))
    add_sample(session, display_name="other place", **in_unit("vn63:gia-lai"), **day("2019-03-15"))

    response = client.get("/api/samples", params={"unit": "vn63:binh-dinh", "dateFrom": "2019-01-01"})

    assert names(response) == ["wanted"]


def test_limit_and_offset_page_through_the_results(session, client):
    for number in range(1, 6):
        add_sample(session, display_name=f"s{number}", **day(f"2020-01-0{number}"))

    page = client.get("/api/samples", params={"limit": 2, "offset": 2})

    assert names(page) == ["s3", "s2"]
    assert (page.json()["total"], page.json()["limit"], page.json()["offset"]) == (5, 2, 2)


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"limit": 501}, "limit"),
        ({"limit": 0}, "limit"),
        ({"offset": -1}, "offset"),
        ({"dateFrom": "2019-13-01"}, "dateFrom"),
        ({"dateFrom": "2019-06-01", "dateTo": "2019-01-01"}, "dateTo"),
        ({"unit": "vn63:khong-co"}, "unit"),
    ],
)
def test_invalid_parameters_are_rejected_with_a_structured_error(client, params, field):
    response = client.get("/api/samples", params=params)

    error = response.json()["error"]
    assert response.status_code == 422
    assert (error["code"], error["message"]) == ("VALIDATION_ERROR", "Invalid request parameters")
    assert [detail["field"] for detail in error["details"]] == [field]
    assert all(detail["message"] for detail in error["details"])


def test_one_sample_can_be_fetched_by_its_internal_id_with_all_its_metadata(session, client):
    sample = add_sample(
        session, display_name="Hà_Nội/01/2018", meta={"serotype_genbank": "denv1", "authors": "A et al."}
    )
    session.add(SampleSequence(sample_id=sample.id, sequence="ACGTAC", length=6, sha256="0" * 64))
    session.flush()

    response = client.get(f"/api/samples/{sample.internal_id}")

    body = response.json()
    assert response.status_code == 200
    assert (body["internalId"], body["displayName"], body["sequenceLength"]) == (
        sample.internal_id,
        "Hà_Nội/01/2018",
        6,
    )
    assert body["meta"] == {"serotype_genbank": "denv1", "authors": "A et al."}
    assert "sequence" not in body


def test_an_unknown_internal_id_gives_a_structured_404(client):
    response = client.get("/api/samples/S9999999")

    assert response.status_code == 404
    assert response.json() == {"error": {"code": "SAMPLE_NOT_FOUND", "message": "No sample with id S9999999"}}


def test_an_unknown_route_uses_the_same_error_shape(client):
    response = client.get("/api/khong-co")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
