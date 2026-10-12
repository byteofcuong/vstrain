"""Hàm dùng chung của các test: tạo và xoá database, thêm mẫu."""

import itertools
from typing import Any

from sqlalchemy import create_engine, make_url, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Sample

TEST_DATABASE = "vietstrain_test"


def database_url(name: str) -> str:
    return make_url(settings.database_url).set(database=name).render_as_string(hide_password=False)


def recreate_database(name: str) -> str:
    """Tạo lại một database trống và trả về URL của nó."""
    admin = create_engine(database_url("postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()
    return database_url(name)


def drop_database(name: str) -> None:
    admin = create_engine(database_url("postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


_sample_numbers = itertools.count(1)


def add_sample(session: Session, **fields: Any) -> Sample:
    """Thêm một mẫu với các trường bắt buộc đã điền sẵn; mỗi mẫu có accession riêng."""
    number = next(_sample_numbers)
    defaults = {
        "display_name": f"sample-{number}",
        "pathogen": "dengue",
        "source": "genbank",
        "accession": f"T{number:07d}",
        "country": "Vietnam",
        "geo_status": "missing",
    }
    sample = Sample(**(defaults | fields))
    session.add(sample)
    session.flush()
    session.refresh(sample)
    return sample
