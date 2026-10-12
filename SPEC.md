# Spec: VietStrain (tên tạm)

Đặc tả này là nguồn sự thật về "xây cái gì và thế nào là xong". Nó được suy ra từ plan đã duyệt ngày 2026-10-12 và từ số đo trong `D:\nextstrain\do-dac\`. Khi quyết định thay đổi, sửa file này trước rồi mới sửa mã.

## Objective

Một webapp giám sát bộ gen mầm bệnh cho Việt Nam, có tính năng lõi như Nextstrain (cây phát sinh loài theo thời gian, bản đồ, lọc và tô màu), nhưng thiết kế cho **vận hành liên tục** thay vì công bố theo lô.

Người dùng:
- **Khách:** xem dataset, cây, bản đồ; tra cứu mẫu.
- **Người nộp** (phòng xét nghiệm): nộp chuỗi kèm metadata, thấy mẫu của mình trên cây trong vòng chưa tới một phút.
- **Admin:** theo dõi job, chạy build, sửa địa danh chưa khớp.

Thành công nghĩa là năm vấn đề đã đo được ở Nextstrain đều được xử lý và đo lại được (mục Success Criteria).

## Capability map

| Module id | Trách nhiệm | Phụ thuộc | Mốc trong plan |
|---|---|---|---|
| `platform` | Repo, Docker Compose, kết nối DB, health check, khung test | — | M0 |
| `geo` | Đơn vị hành chính (63 tỉnh, 34 đơn vị, vùng), tên thay thế, chuẩn hoá địa danh | `platform` | M1 |
| `samples` | Bản ghi mẫu và chuỗi, nhập từ GenBank, API tra cứu | `platform`, `geo` | M1 |
| `job-queue` | Hàng đợi job trong PostgreSQL, worker, gọi công cụ ngoài an toàn | `platform` | M2 |
| `build` | Gióng từng mẫu, dựng cây theo dataset, publish file build | `samples`, `job-queue` | M2 |
| `viewer` | Danh sách dataset, cây Canvas, lọc, tô màu, tooltip, song ngữ | `build` | M3 |
| `map` | Bản đồ tô màu theo tỉnh, chuyển bộ 63/34 | `viewer`, `geo` | M4 |
| `accounts` | Đăng nhập, phiên, vai trò | `platform` | M5 |
| `submission` | Nộp mẫu, QC, đặt mẫu tạm vào cây, hiển thị tip tạm | `accounts`, `samples`, `job-queue`, `build`, `viewer` | M5 |
| `operations` | Lịch build, trang theo dõi job, trang sửa địa danh | `job-queue`, `build`, `geo`, `accounts` | M6 |
| `evaluation` | Đo lại năm chỉ số, README, bảng kết quả | tất cả | M7 |

Thứ tự xây: `platform` → `geo` → `samples` → `job-queue` → `build` → `viewer` → `map` và `accounts` → `submission` → `operations` → `evaluation`.

Mỗi module có đặc tả riêng ở `specs/SPEC-<module id>.md`, viết ngay trước khi bắt đầu module đó. Ba module đầu đủ nhỏ nên đặc tả của chúng nằm luôn trong `tasks/todo.md`.

## Tech Stack

| Thành phần | Chọn | Ghi chú |
|---|---|---|
| Backend | Python ≥ 3.11, FastAPI, SQLAlchemy 2, Alembic, psycopg 3 | API chạy trên `python:3.12-slim`; worker chạy trong image dẫn xuất từ `nextstrain/base:build-20260930T105229Z` (Python 3.11) |
| Cơ sở dữ liệu | PostgreSQL 16 | Kiêm hàng đợi job (`FOR UPDATE SKIP LOCKED`) |
| Công cụ sinh học | Augur 34.1.4, Nextclade 3.24, IQ-TREE 3.0.1, TreeTime 0.12.1 | Đúng phiên bản đã đo |
| Frontend | React 19, TypeScript, Vite, Zustand, MapLibre GL | Từ module `viewer` |
| Triển khai | Docker Compose trên một máy | Chưa có HTTPS, chưa lên server |

Lý do của từng lựa chọn lớn được ghi thành ADR trong `docs/decisions/`.

## Commands

Chạy từ thư mục gốc của repo (`D:\nextstrain\webapp`), bằng Git Bash hoặc PowerShell.

```
Khởi động:      docker compose -f deploy/docker-compose.yml up -d --build
Dừng:           docker compose -f deploy/docker-compose.yml down
Test (tất cả):  docker compose -f deploy/docker-compose.yml run --rm api pytest
Test (một file): docker compose -f deploy/docker-compose.yml run --rm api pytest tests/test_health.py
Lint:           docker compose -f deploy/docker-compose.yml run --rm api ruff check .
Format (kiểm):  docker compose -f deploy/docker-compose.yml run --rm api ruff format --check .
Health:         curl -s http://127.0.0.1:8000/api/health
Migration:      docker compose -f deploy/docker-compose.yml run --rm migrate
```

Migration cũng tự chạy mỗi lần khởi động (service `migrate`). Test dùng database riêng `vietstrain_test`, được tạo lại ở đầu mỗi phiên test.

Lệnh nhập dữ liệu và lệnh frontend được thêm vào đây khi lát cắt tương ứng hoàn thành.

## Project Structure

```
SPEC.md               → đặc tả tổng (file này)
specs/                → đặc tả từng module
tasks/plan.md         → kế hoạch triển khai
tasks/todo.md         → danh sách task, tiêu chí nghiệm thu, checkpoint
docs/decisions/       → ADR: lý do của các quyết định kiến trúc
deploy/               → docker-compose.yml, Dockerfile
backend/app/          → mã backend, mỗi module một gói con (geo/, samples/, ...)
backend/migrations/   → migration Alembic
backend/tests/        → pytest
frontend/             → React (từ module viewer)
data/                 → dữ liệu cục bộ và file build; không đưa vào git
```

## Code Style

Tên bằng tiếng Anh; docstring và comment bằng tiếng Việt, chỉ giải thích lý do. Có type hint. Hàm ngắn, làm một việc.

```python
def place_key(raw: str) -> str:
    """Khoá so khớp địa danh: bỏ dấu, chữ thường, bỏ tiền tố hành chính, chỉ giữ chữ và số.

    "Tỉnh Đắk Lắk", "Dak Lak" và "DAKLAK" đều cho "daklak".
    """
    tokens = _strip_admin_words(_ascii_tokens(raw))
    return "".join(tokens)
```

- Python: `ruff` (lint và format), dòng tối đa 120 ký tự.
- SQL đi qua SQLAlchemy; thay đổi schema đi qua migration.
- Gọi công cụ ngoài bằng danh sách đối số, không bao giờ qua shell.
- Tên test mô tả hành vi: `test_place_key_ignores_diacritics_and_spacing`.

## Testing Strategy

- **Quy trình:** viết test thất bại trước, rồi viết mã cho nó qua (red → green → refactor).
- **Unit (phần lớn):** hàm thuần như chuẩn hoá địa danh, phân tích ngày, chuyển định dạng cây. Không I/O.
- **Tích hợp:** API và truy vấn chạy với PostgreSQL thật trong container (database riêng cho test); không mock DB.
- **Pipeline:** chạy công cụ thật (Nextclade, Augur) trên bộ dữ liệu nhỏ vài chục chuỗi, trong image worker.
- **Đầu-cuối:** Playwright, chỉ cho các luồng chính (xem dataset; nộp mẫu → tip tạm → build).
- **Hiệu năng:** harness đo riêng, không nằm trong bộ test chặn commit.

## Boundaries

- **Luôn làm:** chạy test và lint trước mỗi commit; mỗi lát cắt được kiểm chứng lúc chạy thật; pipeline chỉ thấy mã nội bộ của mẫu; thay đổi schema có migration; chuỗi hiển thị đi qua lớp dịch.
- **Hỏi trước:** cài thêm dependency hoặc image ngoài danh sách đã duyệt; tải bộ dữ liệu ngoài (đường biên tỉnh); đổi công nghệ; migration làm mất dữ liệu; xoá volume dữ liệu; đổi cấu hình máy.
- **Không bao giờ:** push lên remote hay công bố ra ngoài; commit secret hoặc file dữ liệu; đưa chuỗi do người dùng nhập vào shell; tắt hoặc xoá test để bộ test qua; sửa file trong `D:\nextstrain\repos\`.

## Definition of Done (áp cho mọi task)

- Tiêu chí nghiệm thu của task đều đạt, đã kiểm chứng lúc chạy thật.
- Hành vi mới có test, và test đó đã từng thất bại trước khi có mã.
- Toàn bộ test qua; lint và format qua.
- Task được đánh dấu trong `tasks/todo.md` và có commit riêng.
- Quyết định kiến trúc mới hoặc giao diện công khai mới được ghi lại (ADR hoặc SPEC).

## Success Criteria

Ngưỡng dưới đây suy từ số đo baseline; cột cuối ghi nguồn.

| # | Tiêu chí | Ngưỡng | Baseline đã đo |
|---|---|---|---|
| 1 | Nộp một genome hợp lệ vào dataset ≤ 5000 tip, tip tạm hiện trên cây | ≤ 30 giây từ lúc nộp | Dựng lại toàn bộ: 2020 s |
| 1b | Mẫu đặt tạm có hàng xóm gần nhất trùng với cây dựng lại | ≥ 85% | Prototype A: 88–91% (trần 94–97%) |
| 2 | Build không chạy lại bước gióng hàng; thời gian từng bước được ghi | Build N = 2000 không chậm hơn 771 s | P1: 771 s, trong đó `align` 72 s |
| 3 | Dataset 35k tip: thời gian tới khung hình đầu | ≤ 1 giây | Auspice 4,44 s; prototype B 0,44 s |
| 3b | Dataset 35k tip: lọc hoặc đổi màu | ≤ 100 ms main thread bận | Auspice 1971–2879 ms |
| 3c | Hover và click vào tip cho đúng mẫu | Có | Prototype B chưa có |
| 4 | 4.305 bản ghi dengue Việt Nam: gán được tỉnh | ≥ 781 bản ghi (18,1%) | Nextstrain: 88 (2,0%) |
| 4b | Gán được tỉnh hoặc vùng | 2.306 bản ghi (53,6%), tức mọi giá trị không trống | — |
| 4c | 331 cách viết của 63 tỉnh ra đúng tỉnh | ≥ 95% | Augur chỉ đổi 30/331 giá trị |
| 5 | Mẫu tên "Hà_Nội/01/2024" đi trọn luồng nộp và build | Qua | `augur tree` thoát mã 2 |
| 5b | Chuỗi tấn công trong tham số không được thực thi | Không tạo file, job bị từ chối | `--tree-builder-args` thực thi lệnh |

Trần của tiêu chí 4 và 4b do chính dữ liệu quyết định: 1.999 bản ghi để trống địa danh.

## Assumptions

1. Tên "VietStrain" là tạm.
2. Chạy trên một máy bằng Docker Compose; chưa có HTTPS, chưa triển khai lên server.
3. Pathogen đầu tiên là dengue; bốn serotype là bốn dataset; làm DENV1 trước.
4. Chỉ genome có ít nhất 10.000 nucleotide hợp lệ mới vào build; bản ghi ngắn hơn vẫn được lưu và tra cứu.
5. Giao diện mặc định tiếng Việt, có tiếng Anh; trình duyệt desktop hiện đại; chưa tối ưu cho điện thoại.
6. Mọi dữ liệu đều công khai, nên chưa có phân quyền theo nhóm.
7. Mã đơn vị hành chính là mã nội bộ (`vn63:dak-lak`) cho tới khi đối chiếu danh mục chính thức.
8. Commit cục bộ sau mỗi lát cắt trên nhánh `feature/*`; không push.

## Open Questions

1. Tên chính thức của dự án.
2. Các ngưỡng ở Success Criteria có đúng với kỳ vọng của bạn và của giảng viên hướng dẫn không.
3. (`accounts`) Ai được tạo tài khoản: chỉ admin, hay cho tự đăng ký?
4. (`submission`) Mẫu nộp qua web hiện công khai ngay khi đạt QC, hay cần admin duyệt?
5. (`geo`, `map`) Nguồn mã tỉnh chính thức và nguồn đường biên có giấy phép mở.
