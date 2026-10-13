"""Đặt một mẫu vào cây của một build đã có bằng Nextclade, thay vì dựng lại cây.

Với Nextstrain, thêm một mẫu là dựng lại toàn bộ (771 giây ở 2.000 chuỗi). Nextclade so mẫu với các node của
cây có sẵn và gắn nó vào chỗ gần nhất trong chưa tới một giây. Kết quả là một "tip tạm": nó cho biết mẫu nằm
gần những mẫu nào, còn vị trí chính thức chỉ có sau lần build kế tiếp.
"""

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.build.align import RawSequence, is_nucleotide_text, raw_sequences
from app.build.publish import build_folder, builds_root
from app.config import settings
from app.jobs.steps import JobContext
from app.models import (
    Build,
    BuildSample,
    DatasetDef,
    Sample,
    SampleAlignment,
    SamplePlacement,
    SampleStatus,
)
from app.pathogens import Lineage, get_lineage

_TIMEOUT_SECONDS = 600


class PlacementFailed(RuntimeError):
    """Có lần gắn bị hỏng (công cụ lỗi, cây không đọc được). Chỉ được ném sau khi mọi lần gắn còn lại đã được thử."""

    def __init__(self, attempted: int, failures: list[str]) -> None:
        # Lỗi của job chỉ giữ phần cuối của thông báo, nên con số đứng trước và danh sách được cắt ngắn ở đây.
        listed = "; ".join(failures[:5]) + (f"; and {len(failures) - 5} more" if len(failures) > 5 else "")
        super().__init__(f"{len(failures)} of {attempted} placements failed: {listed}")


@dataclass(frozen=True)
class Placement:
    """Chỗ một mẫu được gắn vào cây, nói bằng tên các node của cây gốc để viewer tìm lại được."""

    parent_node: str  # node gần nhất phía trên mẫu mà cây gốc có
    # Node của cây gốc mà cành dẫn tới nó bị chẻ ra để gắn mẫu; `None` khi mẫu treo thẳng vào `parent_node`.
    branch_node: str | None
    attach_div: float  # độ phân kỳ tại điểm gắn
    div: float  # độ phân kỳ của mẫu


def node_names(auspice: dict[str, Any]) -> set[str]:
    """Tên mọi node của một cây Auspice v2. Duyệt bằng ngăn xếp: cây thật có thể sâu hàng nghìn tầng."""
    names: set[str] = set()
    pending = [auspice["tree"]]
    while pending:
        node = pending.pop()
        names.add(node["name"])
        pending.extend(node.get("children") or [])
    return names


def _div(node: dict[str, Any]) -> float:
    value = node.get("node_attrs", {}).get("div")
    if not isinstance(value, int | float):
        raise ValueError(f"Node {node['name']} of the placed tree has no divergence")
    return float(value)


def read_placement(placed: dict[str, Any], base_names: set[str], tip: str) -> Placement:
    """Tìm mẫu `tip` trong cây Nextclade trả về và mô tả chỗ gắn theo các node của cây gốc.

    Nextclade hoặc treo mẫu thẳng vào một node có sẵn, hoặc chẻ một cành bằng một node mới rồi treo mẫu vào đó.
    `LookupError` nếu cây không có mẫu; `ValueError` nếu chỗ gắn không mô tả được.
    """
    # Cây JSON không có con trỏ tới node cha: ghi lại cha của từng node trong lúc tìm, để lần ngược lên được.
    parent_of: dict[int, dict[str, Any]] = {}
    pending = [placed["tree"]]
    while pending:
        node = pending.pop()
        if node["name"] == tip:
            break
        for child in node.get("children") or []:
            parent_of[id(child)] = node
            pending.append(child)
    else:
        raise LookupError(f"Sample {tip} is not in the placed tree")

    if node.get("children"):
        raise ValueError(f"Sample {tip} is not a tip of the placed tree")
    attached_to = anchor = parent_of.get(id(node))
    while anchor is not None and anchor["name"] not in base_names:
        anchor = parent_of.get(id(anchor))
    if attached_to is None or anchor is None:
        raise ValueError(f"Sample {tip} has no node of the build above it")

    branch = None
    if attached_to is not anchor:
        siblings = (child["name"] for child in attached_to["children"] if child is not node)
        branch = next((name for name in siblings if name in base_names), None)
    return Placement(parent_node=anchor["name"], branch_node=branch, attach_div=_div(attached_to), div=_div(node))


def place_on_build(
    context: JobContext, lineage: Lineage, dataset: DatasetDef, build: Build, sample: RawSequence, *, name: str
) -> Placement | None:
    """Gắn một mẫu vào cây của `build` và ghi chỗ gắn vào `sample_placement`; `None` nếu Nextclade không đặt được.

    Công cụ chỉ thấy mã nội bộ và chuỗi của mẫu. Chỉ flush.
    """
    if not is_nucleotide_text(sample.sequence):
        raise ValueError(f"Sequence of {sample.internal_id} contains characters that are not nucleotide codes")
    tree_path = builds_root() / build_folder(dataset, build) / "auspice.json"
    folder = context.work_dir / name
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / "input.fasta").open("w", encoding="ascii", newline="\n") as handle:
        handle.write(f">{sample.internal_id}\n{sample.sequence}\n")
    context.run_tool(
        name,
        [
            "nextclade",
            "run",
            f"--input-ref={lineage.reference_fasta}",
            f"--input-annotation={lineage.annotation}",
            f"--input-tree={tree_path}",
            *lineage.nextclade_alignment_args,
            f"--output-ndjson={folder / 'placed.ndjson'}",
            f"--output-tree={folder / 'placed.json'}",
            f"--jobs={settings.tool_threads}",
            folder / "input.fasta",
        ],
        timeout=_TIMEOUT_SECONDS,
    )

    records = [json.loads(line) for line in (folder / "placed.ndjson").read_text(encoding="utf-8").splitlines() if line]
    record = next((one for one in records if one.get("seqName") == sample.internal_id), None)
    # Chuỗi mà Nextclade không gióng được có dòng kết quả mang `errors` và không có mặt trong cây.
    if record is None or record.get("errors"):
        return None
    base_names = node_names(json.loads(tree_path.read_text(encoding="utf-8")))
    placed = read_placement(
        json.loads((folder / "placed.json").read_text(encoding="utf-8")), base_names, sample.internal_id
    )

    values = {
        "parent_node": placed.parent_node,
        "branch_node": placed.branch_node,
        "attach_div": placed.attach_div,
        "div": placed.div,
        "private_mutations": int(record["privateNucMutations"]["totalPrivateSubstitutions"]),
        "clade": record.get("clade"),
    }
    statement = insert(SamplePlacement).values(sample_id=sample.id, build_id=build.id, **values)
    replaced = {**values, "placed_at": statement.excluded.placed_at}
    context.session.execute(
        statement.on_conflict_do_update(
            index_elements=[SamplePlacement.sample_id, SamplePlacement.build_id], set_=replaced
        )
    )
    context.session.flush()
    return placed


def _current_builds(context: JobContext, pathogen: str, lineage: str, slug: str | None = None) -> list[Any]:
    """Các dataset của một lineage đang có build hiện hành đã publish, kèm build đó."""
    query = (
        select(DatasetDef, Build)
        .join(Build, Build.dataset_id == DatasetDef.id)
        .where(
            DatasetDef.pathogen == pathogen,
            DatasetDef.lineage == lineage,
            Build.is_current,
            Build.path.is_not(None),
        )
        .order_by(DatasetDef.slug)
    )
    if slug is not None:
        query = query.where(DatasetDef.slug == slug)
    return list(context.session.execute(query).all())


def place_sample(context: JobContext, sample_id: int) -> list[str]:
    """Đặt một mẫu đã qua kiểm tra lên mọi dataset của lineage của nó; trả về slug các dataset đã đặt được.

    Dataset mà build hiện hành đã có mẫu thì bỏ qua: ở đó mẫu là một tip chính thức. Một dataset làm lần gắn hỏng
    không chặn các dataset sau nó; `PlacementFailed` được ném khi đã thử hết.
    """
    session = context.session
    found = session.execute(
        select(Sample.pathogen, SampleAlignment.lineage)
        .join(SampleAlignment, SampleAlignment.sample_id == Sample.id)
        .where(
            Sample.id == sample_id,
            Sample.status == SampleStatus.ACCEPTED.value,
            SampleAlignment.status == "aligned",
        )
    ).one_or_none()
    if found is None:
        return []
    lineage = get_lineage(found.pathogen, found.lineage)
    (sample,) = raw_sequences(session, [sample_id])

    placed: list[str] = []
    failures: list[str] = []
    attempted = 0
    for dataset, build in _current_builds(context, found.pathogen, found.lineage):
        slug = dataset.slug
        if session.get(BuildSample, (build.id, sample_id)) is not None:
            continue
        attempted += 1
        try:
            if place_on_build(context, lineage, dataset, build, sample, name=f"place-{slug}") is not None:
                placed.append(slug)
            session.commit()
        except Exception as error:
            session.rollback()  # bỏ phần ghi dở của lần gắn hỏng; các lần trước đã commit
            failures.append(_failure(slug, error))
    if failures:
        raise PlacementFailed(attempted, failures)
    return placed


def _failure(what: str, error: Exception) -> str:
    first_line = next(iter(str(error).splitlines()), "")
    return f"{what}: {type(error).__name__}: {first_line[:200]}"


def place_pending(context: JobContext) -> dict[str, Any]:
    """Job đặt lại các mẫu đã nộp lên build hiện hành của một dataset (tham số `dataset`).

    Chạy sau mỗi lần build: mẫu đã vào build thành tip chính thức, mẫu chưa vào (nộp sau khi build chọn mẫu, hoặc
    bị bước lọc đồng hồ phân tử loại) được gắn tạm vào cây mới, vì chỗ gắn trên cây cũ không còn nghĩa.

    Một mẫu làm lần gắn hỏng không chặn các mẫu sau nó: job này không tự chạy lại, nên dừng ở mẫu đó thì những mẫu
    đứng sau không bao giờ thành mẫu tạm. `PlacementFailed` được ném khi đã thử hết, để job vẫn được ghi là hỏng.
    """
    context.check_params("dataset")
    session = context.session
    slug = context.params.get("dataset")
    dataset = session.scalars(select(DatasetDef).filter_by(slug=slug)).one_or_none() if isinstance(slug, str) else None
    if dataset is None:
        raise LookupError(f"No dataset with slug {slug!r}")
    current = _current_builds(context, dataset.pathogen, dataset.lineage, dataset.slug)
    if not current:
        return {"dataset": dataset.slug, "build_id": None, "placed": 0, "unplaced": 0}
    _, build = current[0]
    lineage = get_lineage(dataset.pathogen, dataset.lineage)

    in_build = select(BuildSample.sample_id).where(BuildSample.build_id == build.id)
    already = select(SamplePlacement.sample_id).where(SamplePlacement.build_id == build.id)
    waiting = session.scalars(
        select(Sample.id)
        .join(SampleAlignment, SampleAlignment.sample_id == Sample.id)
        .where(
            Sample.source == "submission",
            Sample.pathogen == dataset.pathogen,
            Sample.status == SampleStatus.ACCEPTED.value,
            SampleAlignment.lineage == dataset.lineage,
            SampleAlignment.status == "aligned",
            Sample.id.not_in(in_build),
            Sample.id.not_in(already),
        )
        .order_by(Sample.id)
    ).all()

    placed = 0
    failures: list[str] = []
    for number, sample in enumerate(raw_sequences(session, waiting), start=1):
        # Mỗi mẫu một lần chạy: đặt cả lô thì Nextclade gắn các mẫu mới vào nhau, không còn là vị trí so với build.
        try:
            if place_on_build(context, lineage, dataset, build, sample, name=f"place-{number:04d}") is not None:
                placed += 1
            session.commit()
        except Exception as error:
            session.rollback()  # bỏ phần ghi dở của mẫu hỏng; các mẫu trước đã commit
            failures.append(_failure(sample.internal_id, error))
    if failures:
        raise PlacementFailed(len(waiting), failures)
    return {"dataset": dataset.slug, "build_id": build.id, "placed": placed, "unplaced": len(waiting) - placed}
