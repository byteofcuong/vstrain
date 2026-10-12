"""Hàm dùng chung của các test: tạo và xoá database, thêm mẫu, dựng một build giả."""

import itertools
import json
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, make_url, text
from sqlalchemy.orm import Session

from app.build.publish import store_tree
from app.config import settings
from app.models import Build, BuildSample, DatasetDef, Sample

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


def star_tree(tips: list[str]) -> dict:
    """Cây hình sao: một gốc và mọi tip là con trực tiếp, đủ để thử việc publish."""
    children = [
        {
            "name": tip,
            "node_attrs": {
                "div": 0.01 * (i + 1),
                "num_date": {"value": 2019.5},
                "clade_membership": {"value": "DENV1/I"},
            },
        }
        for i, tip in enumerate(tips)
    ]
    root_attrs = {"div": 0, "num_date": {"value": 2010.0}, "clade_membership": {"value": "unassigned"}}
    return {
        "version": "v2",
        "meta": {},
        "tree": {"name": "NODE_0000000", "node_attrs": root_attrs, "children": children},
    }


def make_build(session, dataset: DatasetDef, samples: list[Sample], root: Path, tmp_path: Path) -> Build:
    build = Build(dataset_id=dataset.id, sample_count=len(samples))
    session.add(build)
    session.flush()
    for sample in samples:
        role = "home" if sample.country == "Vietnam" else "context"
        session.add(BuildSample(build_id=build.id, sample_id=sample.id, role=role))
    session.flush()
    source = tmp_path / f"auspice-{build.id}.json"
    source.write_text(json.dumps(star_tree([sample.internal_id for sample in samples])), encoding="utf-8")
    store_tree(dataset, build, source, root)
    return build
