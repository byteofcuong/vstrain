"""Thống kê mức gán địa danh của các mẫu trong nước (tiêu chí 4 và 4b của SPEC)."""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.geo.resolve import GeoStatus
from app.models import AdminUnit, Sample


def geo_report(session: Session, country: str = "Vietnam") -> dict[str, Any]:
    in_country = Sample.country == country
    samples = func.count().label("samples")

    status_rows = session.execute(select(Sample.geo_status, samples).where(in_country).group_by(Sample.geo_status))
    by_status = {status: count for status, count in status_rows}

    def by(column: Any, status: GeoStatus) -> list[dict[str, Any]]:
        rows = session.execute(
            select(AdminUnit.code, AdminUnit.name_vi, samples)
            .join(Sample, column == AdminUnit.code)
            .where(in_country, Sample.geo_status == status.value)
            .group_by(AdminUnit.code, AdminUnit.name_vi)
            .order_by(samples.desc(), AdminUnit.code)
        )
        return [{"code": code, "name": name, "samples": count} for code, name, count in rows]

    unresolved = session.execute(
        select(Sample.division_raw, Sample.location_raw, samples)
        .where(in_country, Sample.geo_status == GeoStatus.UNRESOLVED.value)
        .group_by(Sample.division_raw, Sample.location_raw)
        .order_by(samples.desc(), Sample.division_raw, Sample.location_raw)
    )

    with_province = by_status.get(GeoStatus.PROVINCE.value, 0)
    return {
        "country": country,
        "total": sum(by_status.values()),
        "by_status": by_status,
        "with_province": with_province,
        "with_province_or_region": with_province + by_status.get(GeoStatus.REGION.value, 0),
        "by_unit": by(Sample.admin_unit_code, GeoStatus.PROVINCE),
        "by_region_only": by(Sample.region_code, GeoStatus.REGION),
        "unresolved_values": [
            {"division": division, "location": location, "samples": count} for division, location, count in unresolved
        ],
    }
