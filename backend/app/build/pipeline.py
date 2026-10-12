"""Job dựng cây cho một dataset.

Các bước giống pipeline đã đo ở P1 (tree, refine, ancestral, translate, export) trừ ba điểm:
- không có bước gióng hàng: alignment được ghép từ chuỗi đã gióng sẵn của từng mẫu (ADR-005);
- IQ-TREE được gọi thẳng với đúng các đối số mà `augur tree` dùng, vì `augur tree` ghép lệnh cho shell (ADR-003);
- công cụ chỉ thấy mã nội bộ và ngày; mọi thuộc tính khác của mẫu được ghép vào lúc publish.
"""

import json
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select

from app.build.inputs import start_build, write_inputs
from app.build.publish import publish_build, store_tree
from app.config import settings
from app.jobs.steps import JobContext
from app.models import Build, BuildSample, DatasetDef, Sample
from app.pathogens import Lineage, get_lineage

# Cây lớn làm Bio.Phylo vượt giới hạn đệ quy mặc định của Python (như ở phép đo P1).
_AUGUR_ENV = {"AUGUR_RECURSION_LIMIT": "100000"}
_HOUR = 3600


def tip_names(auspice: dict[str, Any]) -> set[str]:
    """Tên các tip của một cây Auspice v2. Duyệt bằng ngăn xếp: cây thật có thể sâu hàng nghìn tầng."""
    names: set[str] = set()
    pending = [auspice["tree"]]
    while pending:
        node = pending.pop()
        children = node.get("children")
        if children:
            pending.extend(children)
        else:
            names.add(node["name"])
    return names


def run_tree_steps(context: JobContext, lineage: Lineage) -> Path:
    """Từ `aligned.fasta`, `metadata.tsv`, `clades.tsv` trong thư mục làm việc tới `auspice.json`."""
    context.run_tool(
        "tree",
        [
            "iqtree",
            "--threads-max",  # IQ-TREE không nhận dạng `--threads-max=8`
            str(settings.tool_threads),
            "-s",
            "aligned.fasta",
            "-m",
            "GTR",
            # Các đối số mặc định của `augur tree` cho IQ-TREE (augur/tree.py, DEFAULT_ARGS).
            "--ninit",
            "2",
            "-n",
            "2",
            "--epsilon",
            "0.05",
            "-T",
            "AUTO",
            "--redo",
            "--prefix",
            "tree",
        ],
        timeout=4 * _HOUR,
    )
    context.run_tool(
        "refine",
        [
            "augur",
            "refine",
            "--tree=tree.treefile",
            "--alignment=aligned.fasta",
            "--metadata=metadata.tsv",
            "--metadata-id-columns=strain",
            "--output-tree=refined.nwk",
            "--output-node-data=branch_lengths.json",
            *lineage.refine_args,
        ],
        timeout=6 * _HOUR,
        env=_AUGUR_ENV,
    )
    context.run_tool(
        "ancestral",
        [
            "augur",
            "ancestral",
            "--tree=refined.nwk",
            "--alignment=aligned.fasta",
            # Gốc cây được so với reference, để cây dùng được làm cây nền cho Nextclade khi đặt mẫu mới.
            f"--root-sequence={lineage.reference_genbank}",
            "--output-node-data=nt_muts.json",
            "--inference=joint",
        ],
        timeout=2 * _HOUR,
        env=_AUGUR_ENV,
    )
    context.run_tool(
        "translate",
        [
            "augur",
            "translate",
            "--tree=refined.nwk",
            "--ancestral-sequences=nt_muts.json",
            f"--reference-sequence={lineage.reference_genbank}",
            "--output-node-data=aa_muts.json",
        ],
        timeout=_HOUR,
        env=_AUGUR_ENV,
    )
    context.run_tool(
        "clades",
        [
            "augur",
            "clades",
            "--tree=refined.nwk",
            "--mutations",
            "nt_muts.json",
            "aa_muts.json",
            "--clades=clades.tsv",
            "--output-node-data=clades.json",
        ],
        timeout=_HOUR,
        env=_AUGUR_ENV,
    )
    context.run_tool(
        "export",
        [
            "augur",
            "export",
            "v2",
            "--tree=refined.nwk",
            "--node-data",
            "branch_lengths.json",
            "nt_muts.json",
            "aa_muts.json",
            "clades.json",
            "--output=auspice.json",
        ],
        timeout=_HOUR,
        env=_AUGUR_ENV,
    )
    return context.work_dir / "auspice.json"


def build_dataset(context: JobContext) -> dict[str, Any]:
    """Job dựng một build mới cho dataset có slug ở tham số `dataset`."""
    context.check_params("dataset")
    session = context.session
    slug = context.params.get("dataset")
    dataset = session.scalars(select(DatasetDef).filter_by(slug=slug)).one_or_none()
    if dataset is None:
        raise LookupError(f"No dataset with slug {slug!r}")
    lineage = get_lineage(dataset.pathogen, dataset.lineage)

    with context.step("select") as step:
        build = start_build(session, dataset, context.job.id)
        build_id = build.id
        session.commit()
    with context.step("prepare") as step:
        step.metrics["samples"] = selected = write_inputs(session, build_id, lineage, context.work_dir)

    auspice_path = run_tree_steps(context, lineage)

    with context.step("publish") as step:
        tips = tip_names(json.loads(auspice_path.read_text(encoding="utf-8")))
        # `augur refine --clock-filter-iqd` loại mẫu lệch đồng hồ phân tử; build chỉ giữ mẫu thật sự có trong cây.
        members = dict(
            session.execute(
                select(Sample.internal_id, Sample.id)
                .join(BuildSample, BuildSample.sample_id == Sample.id)
                .where(BuildSample.build_id == build_id)
            ).all()
        )
        dropped = sorted(set(members) - tips)
        if dropped:
            session.execute(
                delete(BuildSample).where(
                    BuildSample.build_id == build_id,
                    BuildSample.sample_id.in_([members[internal_id] for internal_id in dropped]),
                )
            )
        build = session.get(Build, build_id)
        build.sample_count = len(tips)
        build.finished_at = func.now()
        session.flush()
        # Thư mục làm việc của job là đồ dùng một lần; cây được chép sang chỗ bền vững rồi mới publish.
        store_tree(dataset, build, auspice_path)
        path = publish_build(session, build)
        step.metrics.update({"tips": len(tips), "dropped": len(dropped)})

    return {"build_id": build_id, "selected": selected, "tips": len(tips), "dropped": list(dropped), "path": path}


def republish_build(context: JobContext) -> dict[str, Any]:
    """Job publish lại một build đã dựng (tham số `build_id`), sau khi sửa địa danh hay tên mẫu trong DB."""
    context.check_params("build_id")
    build_id = context.params.get("build_id")
    build = context.session.get(Build, build_id) if isinstance(build_id, int) else None
    if build is None:
        raise LookupError(f"No build with id {build_id!r}")
    with context.step("publish"):
        path = publish_build(context.session, build)
    return {"build_id": build.id, "path": path}
