# Nguồn của cấu hình dengue

Các file trong thư mục này được chép từ repo `nextstrain/dengue`, commit `f6bb8a3a854a61eab6a42b0c53bf4f93b9aa1e55` (ngày 2026-09-21), bản đã ghim ở `D:\nextstrain\repos\pathogens\dengue`.

| File ở đây | File gốc trong repo dengue | Ghi chú |
|---|---|---|
| `denvN/reference.gb` | `phylogenetic/defaults/denvN/reference.gb` | Reference của RefSeq: NC_001477.1 (10.735 nt), NC_001474.2 (10.723), NC_001475.2 (10.707), NC_002640.1 (10.649) |
| `denvN/reference.fasta` | sinh từ `reference.gb` | Cùng một chuỗi, dạng FASTA cho Nextclade; có test so hai file |
| `denvN/genome_annotation.gff3` | `nextclade/datasets/denvN/genome_annotation.gff3` | Toạ độ gene. Tên chuỗi trong file là tên reference của dataset Nextclade; toạ độ trùng với RefSeq vì hai reference dài bằng nhau và không lệch khung |
| `clades_genotypes.tsv` | `phylogenetic/defaults/clades_genotypes.tsv` | Định nghĩa genotype theo đột biến axit amin, dùng cho `augur clades` |

Tham số gióng hàng của Nextclade (`app/pathogens/__init__.py`) lấy từ `nextclade/datasets/denvN/pathogen.json` trong cùng repo.

## Điều cần biết

- Repo `nextstrain/dengue` không có file LICENSE ở thư mục gốc. Các file trên là dữ liệu cấu hình nhỏ; chuỗi reference là bản ghi công khai của GenBank. Nếu công bố mã nguồn dự án này thì cần kiểm tra lại điều kiện sử dụng.
- Dataset Nextclade của dengue dùng một reference khác ("reconstructed root sequence"), khác RefSeq vài trăm vị trí nhưng cùng hệ toạ độ. Hệ thống này gióng theo RefSeq để mọi bước (gióng, suy diễn tổ tiên, dịch mã) dùng chung một reference, như pipeline đã đo ở P1.
- Ngưỡng `max_divergence` = 15% được đặt từ quan sát trên bộ thử: genome DENV1 khác NC_001477.1 khoảng 7%, genome DENV2 khác khoảng 31%. Chưa kiểm trên toàn bộ dữ liệu.
