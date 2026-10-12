import datetime as dt
import hashlib
import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.build.columnar import tree_arrays
from app.build.publish import publish_build
from app.geo.seed import seed_geo
from app.models import Build, BuildSample, DatasetDef, Sample
from tests.support import add_sample, make_build, star_tree

AWKWARD_NAME = 'Hà_Nội/01/2024 "mẫu" <b>'


@pytest.fixture
def dataset(session) -> DatasetDef:
    seed_geo(session)
    dataset = DatasetDef(
        slug="dengue-denv1", title="DENV1 Việt Nam", pathogen="dengue", lineage="denv1", max_samples=10
    )
    session.add(dataset)
    session.flush()
    return dataset


@pytest.fixture
def samples(session, dataset) -> list[Sample]:
    day = {"date_min": dt.date(2019, 3, 15), "date_max": dt.date(2019, 3, 15), "collection_date_raw": "2019-03-15"}
    return [
        add_sample(
            session,
            display_name=AWKWARD_NAME,
            admin_unit_code="vn63:khanh-hoa",
            region_code="vnr:north-central-and-central-coast",
            geo_status="province",
            host="Homo sapiens",
            **day,
        ),
        add_sample(session, display_name="south", region_code="vnm:south", geo_status="region", **day),
        add_sample(session, display_name="thai", country="Thailand", geo_status="foreign", host="Aedes aegypti", **day),
    ]


@pytest.fixture
def root(tmp_path) -> Path:
    return tmp_path / "builds"


@pytest.fixture
def build(session, dataset, samples, root, tmp_path) -> Build:
    return make_build(session, dataset, samples, root, tmp_path)


def read(folder: Path, name: str) -> dict:
    return json.loads((folder / name).read_text(encoding="utf-8"))


def test_a_publication_holds_the_tree_the_tip_data_and_one_file_per_attribute(session, build, samples, root):
    folder = root / publish_build(session, build, root)

    tree = read(folder, "tree.json")
    tips = read(folder, "tips.json")
    expected = tree_arrays(star_tree([sample.internal_id for sample in samples]))
    assert sorted(path.name for path in folder.iterdir()) == [
        "auspice.json",
        "col.clade.json",
        "col.country.json",
        "col.host.json",
        "col.region.json",
        "col.role.json",
        "col.unit.json",
        "manifest.json",
        "tips.json",
        "tree.json",
    ]
    assert tree == {key: value for key, value in expected.items() if key != "clade"}
    assert tips == {
        "displayName": [AWKWARD_NAME, "south", "thai"],
        "accession": [sample.accession for sample in samples],
        "collectionDate": ["2019-03-15"] * 3,
    }


def test_tip_attributes_come_from_the_database_as_dictionary_encoded_columns(session, build, root):
    folder = root / publish_build(session, build, root)

    assert read(folder, "col.country.json") == {
        "key": "country",
        "scope": "tip",
        "values": ["Thailand", "Vietnam"],
        "codes": [1, 1, 0],
    }
    assert read(folder, "col.unit.json") == {
        "key": "unit",
        "scope": "tip",
        "values": ["vn63:khanh-hoa"],
        "labels": ["Khánh Hòa"],
        "codes": [0, -1, -1],
    }
    assert read(folder, "col.region.json")["labels"] == ["Miền Nam", "Bắc Trung Bộ và Duyên hải miền Trung"]
    assert read(folder, "col.role.json")["codes"] == [1, 1, 0]
    assert read(folder, "col.host.json")["codes"] == [1, -1, 0]


def test_the_clade_column_covers_every_node_of_the_tree(session, build, root):
    folder = root / publish_build(session, build, root)

    assert read(folder, "col.clade.json") == {
        "key": "clade",
        "scope": "node",
        "values": ["DENV1/I", "unassigned"],
        "codes": [1, 0, 0, 0],
    }


def test_the_manifest_describes_the_dataset_and_every_file_with_its_size_and_hash(session, build, dataset, root):
    folder = root / publish_build(session, build, root)

    manifest = read(folder, "manifest.json")
    listed = {**manifest["files"], **{column["key"]: column["file"] for column in manifest["columns"]}}
    assert manifest["format"] == 1
    assert manifest["dataset"] == {
        "slug": "dengue-denv1",
        "title": "DENV1 Việt Nam",
        "pathogen": "dengue",
        "lineage": "denv1",
    }
    assert manifest["counts"] == {"nodes": 4, "tips": 3}
    assert manifest["build"]["id"] == build.id
    assert [column["key"] for column in manifest["columns"]] == ["clade", "country", "unit", "region", "host", "role"]
    assert manifest["columns"][2]["title"] == {"vi": "Tỉnh, thành", "en": "Province"}
    assert {entry["path"] for entry in listed.values()} == {path.name for path in folder.iterdir()} - {"manifest.json"}
    for entry in listed.values():
        content = (folder / entry["path"]).read_bytes()
        assert (entry["bytes"], entry["sha256"]) == (len(content), hashlib.sha256(content).hexdigest())


def test_the_folder_is_named_after_its_content_and_publishing_again_changes_nothing(session, build, root):
    first = publish_build(session, build, root)
    second = publish_build(session, build, root)

    session.expire_all()
    folder = root / first
    assert first == second == build.path
    assert folder.name == f"p-{build.content_hash[:12]}"
    assert read(folder, "manifest.json")["contentHash"] == build.content_hash
    assert [path.name for path in folder.parent.iterdir() if path.name.startswith("p-")] == [folder.name]
    assert not [path for path in folder.parent.iterdir() if path.name.startswith(".tmp")]


def test_fixing_a_place_and_publishing_again_gives_a_new_folder_with_the_same_tree(session, build, samples, root):
    before = publish_build(session, build, root)
    samples[1].admin_unit_code = "vn63:ho-chi-minh"
    session.flush()

    after = publish_build(session, build, root)

    session.expire_all()
    assert after != before and build.path == after
    assert (root / before / "tree.json").read_bytes() == (root / after / "tree.json").read_bytes()
    assert read(root / before, "col.unit.json")["values"] == ["vn63:khanh-hoa"]
    assert read(root / after, "col.unit.json")["values"] == ["vn63:ho-chi-minh", "vn63:khanh-hoa"]


def test_the_newest_published_build_becomes_current_and_the_previous_one_stays_available(
    session, dataset, samples, root, tmp_path
):
    old = make_build(session, dataset, samples, root, tmp_path)
    new = make_build(session, dataset, samples[:2], root, tmp_path)

    old_path = publish_build(session, old, root)
    new_path = publish_build(session, new, root)

    session.expire_all()
    current = session.scalars(select(Build).filter_by(dataset_id=dataset.id, is_current=True)).all()
    assert [b.id for b in current] == [new.id]
    assert (old.path, old.is_current) == (old_path, False)
    assert (root / old_path / "manifest.json").is_file() and (root / new_path / "manifest.json").is_file()
    assert old.published_at is not None and new.published_at is not None


def test_publishing_an_older_build_again_does_not_take_over_from_a_newer_one(session, dataset, samples, root, tmp_path):
    old = make_build(session, dataset, samples, root, tmp_path)
    new = make_build(session, dataset, samples[:2], root, tmp_path)
    publish_build(session, old, root)
    publish_build(session, new, root)

    publish_build(session, old, root)

    session.expire_all()
    assert (old.is_current, new.is_current) == (False, True)


def test_a_tip_that_is_not_a_sample_of_the_build_is_an_error(session, dataset, samples, root, tmp_path):
    build = make_build(session, dataset, samples, root, tmp_path)
    session.query(BuildSample).filter_by(build_id=build.id, sample_id=samples[2].id).delete()
    session.flush()

    with pytest.raises(ValueError, match=samples[2].internal_id):
        publish_build(session, build, root)
