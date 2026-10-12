from app.geo.seed import seed_geo
from app.models import Sample
from app.samples.report import geo_report


def add_sample(session, number: int, status: str, **fields) -> None:
    defaults = {"display_name": f"s{number}", "pathogen": "dengue", "source": "genbank", "country": "Vietnam"}
    session.add(Sample(accession=f"AB{number:06d}", geo_status=status, **(defaults | fields)))


def test_report_counts_vietnamese_samples_by_status_unit_and_region(session):
    seed_geo(session)
    add_sample(session, 1, "province", admin_unit_code="vn63:khanh-hoa", division_raw="Nha Trang")
    add_sample(session, 2, "province", admin_unit_code="vn63:khanh-hoa", division_raw="Nha Trang")
    add_sample(session, 3, "province", admin_unit_code="vn63:ha-noi", location_raw="Hanoi")
    add_sample(session, 4, "region", region_code="vnm:south", division_raw="South")
    add_sample(session, 5, "missing")
    add_sample(session, 6, "unresolved", division_raw="Atlantis")
    add_sample(session, 7, "unresolved", division_raw="Atlantis")
    add_sample(session, 8, "foreign", country="Thailand", division_raw="Bangkok")
    session.flush()

    report = geo_report(session)

    assert report["total"] == 7
    assert report["by_status"] == {"province": 3, "region": 1, "missing": 1, "unresolved": 2}
    assert report["with_province"] == 3
    assert report["with_province_or_region"] == 4
    assert report["by_unit"] == [
        {"code": "vn63:khanh-hoa", "name": "Khánh Hòa", "samples": 2},
        {"code": "vn63:ha-noi", "name": "Hà Nội", "samples": 1},
    ]
    assert report["by_region_only"] == [{"code": "vnm:south", "name": "Miền Nam", "samples": 1}]
    assert report["unresolved_values"] == [{"division": "Atlantis", "location": None, "samples": 2}]


def test_report_of_an_empty_database_has_zero_counts(session):
    report = geo_report(session)

    assert (report["total"], report["with_province"], report["with_province_or_region"]) == (0, 0, 0)
    assert report["by_unit"] == []
