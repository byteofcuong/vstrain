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
    # Trong một serotype dengue, genome khác reference khoảng 7%; khác serotype thì khoảng 30%.
    max_divergence: float = 0.15

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


DENGUE: dict[str, Lineage] = {
    f"denv{number}": Lineage(pathogen="dengue", key=f"denv{number}", title=f"Dengue virus {number}")
    for number in (1, 2, 3, 4)
}
