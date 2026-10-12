"""Cấu hình pathogen: reference, annotation, định nghĩa clade và tham số công cụ.

Mọi tham số của công cụ ngoài nằm ở đây, trong repo, và đi qua review. Không tham số nào lấy từ request.
Nguồn của các file dữ liệu ghi ở `app/pathogens/dengue/NGUON.md`.
"""

from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

_ROOT = Path(__file__).parent


@dataclass(frozen=True)
class Lineage:
    """Một nhánh có reference riêng (ví dụ một serotype dengue); mỗi dataset được dựng cho một lineage."""

    pathogen: str
    key: str
    title: str
    min_valid_nt: int = 10_000  # số A, C, G, T tối thiểu sau khi gióng để một genome được vào build
    # Đo trên 21.909 genome: trong một serotype, genome khác reference nhiều nhất khoảng 19% (genotype rừng
    # của DENV2); genome của serotype khác thì khác khoảng 31%. Ngưỡng nằm giữa hai mức đó.
    max_divergence: float = 0.25
    tree_seed: int = 1  # seed của IQ-TREE; không có thì hai lần build cùng đầu vào cho hai cây khác nhau

    @property
    def directory(self) -> Path:
        return _ROOT / self.pathogen / self.key

    @property
    def reference_fasta(self) -> Path:
        return self.directory / "reference.fasta"

    @property
    def reference_genbank(self) -> Path:
        return self.directory / "reference.gb"

    @property
    def annotation(self) -> Path:
        return self.directory / "genome_annotation.gff3"

    @property
    def clades(self) -> Path:
        return _ROOT / self.pathogen / "clades_genotypes.tsv"

    @property
    def clade_prefix(self) -> str:
        """Phần đầu tên clade của lineage này trong file định nghĩa chung, ví dụ "DENV1/"."""
        return f"{self.key.upper()}/"

    @cached_property
    def reference_length(self) -> int:
        lines = self.reference_fasta.read_text(encoding="ascii").splitlines()
        return sum(len(line.strip()) for line in lines if not line.startswith(">"))

    @property
    def nextclade_alignment_args(self) -> tuple[str, ...]:
        """Tham số gióng hàng theo `pathogen.json` của dataset Nextclade dengue, như ingest của Nextstrain."""
        return (
            "--penalty-gap-open=8",
            "--penalty-gap-open-in-frame=12",
            "--penalty-gap-open-out-of-frame=14",
            "--gap-alignment-side=left",
            "--min-seed-cover=0.1",
            "--min-length=1000",
        )

    @property
    def refine_args(self) -> tuple[str, ...]:
        """Tham số của `augur refine`, giữ đúng cấu hình đã đo ở baseline P1 (theo zika-tutorial của Nextstrain)."""
        return (
            "--timetree",
            "--coalescent=opt",
            "--date-confidence",
            "--date-inference=marginal",
            "--clock-filter-iqd=4",
            "--seed=1",
        )


DENGUE: dict[str, Lineage] = {
    f"denv{number}": Lineage(pathogen="dengue", key=f"denv{number}", title=f"Dengue virus {number}")
    for number in (1, 2, 3, 4)
}


def get_lineage(pathogen: str, key: str) -> Lineage:
    """Cấu hình của một lineage; `KeyError` nếu không có trong repo."""
    if pathogen != "dengue":
        raise KeyError(pathogen)
    return DENGUE[key]
