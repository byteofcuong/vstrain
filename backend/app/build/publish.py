"""Publish một build: ghép cây do công cụ dựng với thuộc tính của mẫu trong DB, ghi ra bộ file cho viewer.

Với Nextstrain, metadata được nướng vào file dataset lúc `augur export`; sửa một địa danh là phải chạy lại.
Ở đây cây (từ công cụ) và thuộc tính (từ DB) chỉ gặp nhau ở bước này, nên sửa địa danh hay tên mẫu rồi
publish lại mất chưa tới một giây và không dựng lại cây.

Mỗi lần publish là một thư mục đặt tên theo hash nội dung và không bao giờ bị sửa: URL của mọi file trong đó
có thể được cache vĩnh viễn, còn "bản hiện hành" chỉ là một con trỏ trong DB.
"""

import hashlib
import json
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.build.columnar import encode_column, tree_arrays
from app.config import settings
from app.models import AdminUnit, Build, BuildSample, DatasetDef, Sample

FORMAT_VERSION = 1


@dataclass(frozen=True)
class Attribute:
    key: str
    title_vi: str
    title_en: str
    scope: str = "tip"  # 'tip': một giá trị cho mỗi tip; 'node': một giá trị cho mỗi node của cây


CLADE = Attribute("clade", "Genotype", "Genotype", scope="node")
TIP_ATTRIBUTES = (
    Attribute("country", "Quốc gia", "Country"),
    Attribute("unit", "Tỉnh, thành", "Province"),
    Attribute("region", "Vùng", "Region"),
    Attribute("host", "Vật chủ", "Host"),
    Attribute("role", "Nhóm mẫu", "Sample group"),
)


def builds_root() -> Path:
    return Path(settings.data_dir) / "builds"


def build_folder(dataset: DatasetDef, build: Build) -> str:
    """Thư mục của một build, tương đối so với thư mục gốc; slug đã được DB giới hạn ở chữ thường, số và gạch."""
    return f"{dataset.slug}/b{build.id:06d}"


def store_tree(dataset: DatasetDef, build: Build, auspice_path: Path, root: Path | None = None) -> Path:
    """Giữ lại cây do công cụ dựng (chỉ có mã nội bộ) ở chỗ bền vững, để publish lại được về sau."""
    folder = (root or builds_root()) / build_folder(dataset, build)
    folder.mkdir(parents=True, exist_ok=True)
    return Path(shutil.copyfile(auspice_path, folder / "auspice.json"))


def _dump(content: Any) -> bytes:
    return json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _entry(name: str, content: bytes) -> dict[str, Any]:
    return {"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}


def _tip_rows(session: Session, build: Build, tip_ids: list[str]) -> list[Any]:
    """Dữ liệu của từng tip, theo đúng thứ tự tip trong cây."""
    rows = session.execute(
        select(
            Sample.internal_id,
            Sample.display_name,
            Sample.accession,
            Sample.collection_date_raw,
            Sample.country,
            Sample.admin_unit_code,
            Sample.region_code,
            Sample.host,
            BuildSample.role,
        )
        .join(BuildSample, BuildSample.sample_id == Sample.id)
        .where(BuildSample.build_id == build.id)
    ).all()
    by_id = {row.internal_id: row for row in rows}
    unknown = [tip for tip in tip_ids if tip not in by_id]
    if unknown:
        raise ValueError(f"Tree tips that are not samples of build {build.id}: {', '.join(unknown[:10])}")
    return [by_id[tip] for tip in tip_ids]


def _files(session: Session, dataset: DatasetDef, build: Build, auspice_bytes: bytes) -> dict[str, bytes]:
    arrays = tree_arrays(json.loads(auspice_bytes))
    clades = arrays.pop("clade")
    tips = _tip_rows(session, build, [arrays["name"][index] for index in arrays["tipNode"]])
    unit_names = dict(session.execute(select(AdminUnit.code, AdminUnit.name_vi)).all())

    values = {
        "country": [tip.country for tip in tips],
        "unit": [tip.admin_unit_code for tip in tips],
        "region": [tip.region_code for tip in tips],
        "host": [tip.host for tip in tips],
        "role": [tip.role for tip in tips],
    }
    columns: dict[str, dict[str, Any]] = {CLADE.key: {"key": CLADE.key, "scope": CLADE.scope, **encode_column(clades)}}
    for attribute in TIP_ATTRIBUTES:
        encoded = encode_column(values[attribute.key])
        column: dict[str, Any] = {"key": attribute.key, "scope": attribute.scope, "values": encoded["values"]}
        if attribute.key in ("unit", "region"):
            # Giá trị là mã đơn vị; nhãn là tên để hiển thị.
            column["labels"] = [unit_names[code] for code in encoded["values"]]
        columns[attribute.key] = {**column, "codes": encoded["codes"]}

    files = {
        "tree.json": _dump(arrays),
        "tips.json": _dump(
            {
                "displayName": [tip.display_name for tip in tips],
                "accession": [tip.accession for tip in tips],
                "collectionDate": [tip.collection_date_raw for tip in tips],
            }
        ),
        "auspice.json": auspice_bytes,
    }
    files.update({f"col.{key}.json": _dump(column) for key, column in columns.items()})

    manifest = {
        "format": FORMAT_VERSION,
        "dataset": {
            "slug": dataset.slug,
            "title": dataset.title,
            "pathogen": dataset.pathogen,
            "lineage": dataset.lineage,
        },
        "build": {"id": build.id, "createdAt": build.created_at.isoformat()},
        "counts": {"nodes": arrays["nodeCount"], "tips": arrays["tipCount"]},
        "files": {
            name.removesuffix(".json"): _entry(name, files[name]) for name in ("tree.json", "tips.json", "auspice.json")
        },
        "columns": [
            {
                "key": attribute.key,
                "scope": attribute.scope,
                "type": "categorical",
                "title": {"vi": attribute.title_vi, "en": attribute.title_en},
                "valueCount": len(columns[attribute.key]["values"]),
                "file": _entry(f"col.{attribute.key}.json", files[f"col.{attribute.key}.json"]),
            }
            for attribute in (CLADE, *TIP_ATTRIBUTES)
        ],
    }
    # Hash tính trên manifest chưa có hash; manifest liệt kê hash của mọi file khác, nên nó đại diện cho tất cả.
    manifest["contentHash"] = hashlib.sha256(_dump(manifest)).hexdigest()
    files["manifest.json"] = _dump(manifest)
    return files


def _write_folder(final: Path, files: dict[str, bytes]) -> None:
    """Ghi trọn bộ file vào một thư mục tạm rồi đổi tên: thư mục publish hoặc có đủ, hoặc không tồn tại."""
    if final.exists():
        return
    temporary = final.parent / f".tmp-{uuid.uuid4().hex}"
    temporary.mkdir(parents=True)
    try:
        for name, content in files.items():
            (temporary / name).write_bytes(content)
        try:
            temporary.rename(final)
        except OSError:
            # Một job khác vừa publish đúng nội dung này: thư mục đích đã có đủ, không còn gì phải làm.
            if not final.exists():
                raise
    finally:
        # Thư mục tạm do chính hàm này tạo, tên ngẫu nhiên, nằm cạnh thư mục đích.
        shutil.rmtree(temporary, ignore_errors=True)


def publish_build(session: Session, build: Build, root: Path | None = None) -> str:
    """Publish (hoặc publish lại) một build; trả về thư mục publish, tương đối so với thư mục gốc.

    Build trở thành bản hiện hành của dataset, trừ khi dataset đã có một build mới hơn đang hiện hành.
    """
    root = root or builds_root()
    dataset = session.get(DatasetDef, build.dataset_id)
    folder = build_folder(dataset, build)
    files = _files(session, dataset, build, (root / folder / "auspice.json").read_bytes())
    content_hash = json.loads(files["manifest.json"])["contentHash"]
    path = f"{folder}/p-{content_hash[:12]}"
    _write_folder(root / path, files)

    newer_is_current = session.scalar(
        select(func.count())
        .select_from(Build)
        .where(Build.dataset_id == dataset.id, Build.is_current, Build.id > build.id)
    )
    if not newer_is_current:
        # Bỏ cờ của bản cũ trước: DB chỉ cho phép một bản hiện hành mỗi dataset.
        session.execute(
            update(Build)
            .where(Build.dataset_id == dataset.id, Build.is_current, Build.id != build.id)
            .values(is_current=False)
        )
        build.is_current = True
    build.path = path
    build.content_hash = content_hash
    build.published_at = func.now()
    session.commit()
    return path
