import datetime as dt
import json
from pathlib import Path

import pytest

from app.build.publish import publish_build
from app.config import settings
from app.geo.seed import seed_geo
from app.jobs import queue
from app.models import Build, DatasetDef
from tests.support import add_sample, make_build


@pytest.fixture
def data_dir(tmp_path, monkeypatch) -> Path:
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    return tmp_path


@pytest.fixture
def dataset(session) -> DatasetDef:
    seed_geo(session)
    dataset = DatasetDef(
        slug="dengue-denv1", title="DENV1 Việt Nam", pathogen="dengue", lineage="denv1", max_samples=2000
    )
    session.add(dataset)
    session.flush()
    return dataset


def published(session, dataset: DatasetDef, data_dir: Path, tip_count: int = 2) -> Build:
    day = {"date_min": dt.date(2019, 3, 15), "date_max": dt.date(2019, 3, 15)}
    samples = [add_sample(session, **day) for _ in range(tip_count)]
    build = make_build(session, dataset, samples, data_dir / "builds", data_dir)
    publish_build(session, build)
    return build


def test_list_shows_each_dataset_with_its_current_build_and_manifest_address(session, client, dataset, data_dir):
    session.add(DatasetDef(slug="dengue-denv2", title="DENV2", pathogen="dengue", lineage="denv2", max_samples=2000))
    build = published(session, dataset, data_dir)

    body = client.get("/api/datasets").json()

    first, second = body["items"]
    assert (body["total"], body["limit"], body["offset"]) == (2, 50, 0)
    assert first == {
        "slug": "dengue-denv1",
        "title": "DENV1 Việt Nam",
        "pathogen": "dengue",
        "lineage": "denv1",
        "maxSamples": 2000,
        "buildIntervalHours": None,
        "currentBuild": {
            "id": build.id,
            "sampleCount": 2,
            "publishedAt": first["currentBuild"]["publishedAt"],
            "contentHash": build.content_hash,
            "manifestUrl": f"/builds/{build.path}/manifest.json",
        },
    }
    assert first["currentBuild"]["publishedAt"] is not None
    assert (second["slug"], second["currentBuild"]) == ("dengue-denv2", None)


def test_the_manifest_address_serves_the_published_file_and_lets_it_be_cached_forever(
    session, client, dataset, data_dir
):
    published(session, dataset, data_dir)
    manifest_url = client.get("/api/datasets").json()["items"][0]["currentBuild"]["manifestUrl"]

    response = client.get(manifest_url)
    tree = client.get(manifest_url.replace("manifest.json", "tree.json"))

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert response.json()["dataset"]["slug"] == "dengue-denv1"
    assert tree.json()["tipCount"] == 2


def test_one_dataset_lists_its_builds_with_a_status_derived_from_the_job(session, client, dataset, data_dir):
    done = published(session, dataset, data_dir)
    running_job = queue.enqueue(session, "build_dataset")
    queue.claim(session, "w1")
    failed_job = queue.enqueue(session, "build_dataset")
    queue.fail(session, queue.claim(session, "w1"), "iqtree exited with code 2")
    session.add_all(
        [Build(dataset_id=dataset.id, job_id=running_job.id), Build(dataset_id=dataset.id, job_id=failed_job.id)]
    )
    session.flush()

    body = client.get("/api/datasets/dengue-denv1").json()

    assert body["currentBuild"]["id"] == done.id
    assert [(build["status"], build["isCurrent"]) for build in body["builds"]] == [
        ("failed", False),
        ("running", False),
        ("succeeded", True),
    ]
    assert body["builds"][2]["sampleCount"] == 2


def test_an_unknown_dataset_gives_a_structured_404(client):
    response = client.get("/api/datasets/khong-co")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DATASET_NOT_FOUND"


@pytest.mark.parametrize(
    "path",
    [
        "/builds/dengue-denv1/b000001/auspice.json",  # cây gốc của build, không phải bản publish
        "/builds/khong-co/p-abc/manifest.json",
        "/builds/..%2F..%2Fsecret.json",
        "/builds/dengue-denv1/b000001/p-0123456789ab/a%00b.json",
        "/builds/dengue-denv1/b000001/.tmp-abc/manifest.json",
        "/builds/p-0123456789ab/secret.json",
        "/builds/dengue-denv1/b000001/p-0123456789ab/sub/manifest.json",
        "/builds/dengue-denv1",
    ],
)
def test_only_files_inside_a_publication_folder_are_served(session, client, dataset, data_dir, path):
    build = published(session, dataset, data_dir)
    (data_dir / "secret.json").write_text(json.dumps({"password": "x"}))
    for folder in ("builds/p-0123456789ab", f"builds/dengue-denv1/b{build.id:06d}/.tmp-abc"):
        (data_dir / folder).mkdir(parents=True)
        (data_dir / folder / "secret.json").write_text("{}")
        (data_dir / folder / "manifest.json").write_text("{}")
    assert (data_dir / "builds" / f"dengue-denv1/b{build.id:06d}/auspice.json").is_file()

    response = client.get(path.replace("b000001", f"b{build.id:06d}"))

    assert response.status_code == 404
    assert response.json()["error"]["code"] in ("FILE_NOT_FOUND", "NOT_FOUND")
