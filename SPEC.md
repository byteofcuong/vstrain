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
| Frontend | React 19, TypeScript, Vite, Zustand | Cây vẽ bằng Canvas, bản đồ vẽ bằng SVG; không dùng thư viện bản đồ (ADR-007) |
| Triển khai | Docker Compose trên một máy; nginx 1.28 là cổng vào (`http://127.0.0.1:8080`) | Chưa có HTTPS, chưa lên server |

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
Khởi tạo DB:    docker compose -f deploy/docker-compose.yml run --rm init
Nhập GenBank:   docker compose -f deploy/docker-compose.yml run --rm api python -m app.cli import-genbank --metadata /data/genbank-dengue/metadata_all.tsv --sequences /data/genbank-dengue/sequences_all.fasta
Báo cáo địa danh: docker compose -f deploy/docker-compose.yml run --rm api python -m app.cli geo-report
Test cần công cụ sinh học: docker compose -f deploy/docker-compose.yml run --rm worker pytest -m tools
Xếp một job:    docker compose -f deploy/docker-compose.yml run --rm api python -m app.cli enqueue tool_versions
Xem một job:    docker compose -f deploy/docker-compose.yml run --rm api python -m app.cli job 1
Log của worker: docker compose -f deploy/docker-compose.yml logs -f worker ingest
Tạo tài khoản:  docker compose -f deploy/docker-compose.yml exec api python -m app.cli create-user --email ten@donvi.vn --name "Tên hiển thị" --role submitter
```

Có hai worker: `worker` nhận mọi loại job; `ingest` chỉ nhận việc kiểm tra mẫu vừa nộp (`python -m app.jobs.worker --only ingest_sample`), để một mẫu nộp trong lúc `worker` đang dựng cây không phải chờ. `worker` còn tự xét lịch build của các dataset mỗi phút (ADR-010) và, lúc rảnh, dọn thư mục làm việc cũ, phiên đăng nhập hết hạn, nhật ký quá hạn (`VS_AUDIT_RETENTION_DAYS`, mặc định 365), bản publish đã bị thay thế và build cũ (`VS_PUBLICATION_RETENTION_DAYS`, mặc định 7; `VS_KEEP_BUILDS`, mặc định 5; xem `specs/SPEC-operations.md`). Chỉ chạy một worker chung.

Bộ test đầy đủ chạy được ở cả hai image. Trong image `api` (Python 3.12) các test đánh dấu `tools` tự bỏ qua; trong image `worker` (Python 3.11, có Augur, Nextclade, IQ-TREE) chúng chạy thật.

Trong Git Bash, lệnh có đường dẫn kiểu `/data/...` phải đặt `MSYS_NO_PATHCONV=1` ở trước, nếu không Git Bash đổi nó thành đường dẫn Windows. PowerShell không cần.

`init` chạy migration rồi nạp dữ liệu địa danh (`python -m app.cli init-db`); nó cũng tự chạy mỗi lần khởi động và chạy lại bao nhiêu lần cũng được. Test dùng database riêng `vietstrain_test`, được tạo lại ở đầu mỗi phiên test.

### Frontend

Chạy trong `frontend/`, bằng Node 24 portable (không dùng Node của máy). Trong Git Bash: `export PATH="/d/nextstrain/do-dac/tools/node24:$PATH"`; trong PowerShell: `$env:PATH = "D:\nextstrain\do-dac\tools\node24;$env:PATH"`.

```
Cài:            npm install
Chạy khi phát triển: npm run dev        (http://127.0.0.1:5173, chuyển /api và /builds sang backend ở cổng 8000)
Test logic:     npm run test            (vitest)
Kiểm tra kiểu:  npm run typecheck
Lint và format: npm run lint            (eslint và prettier --check)
Build:          npm run build
Test đầu-cuối:  npm run e2e             (Playwright; cần backend đang chạy và dataset dengue-denv1 đã có build)
Test qua nginx: npm run e2e:web         (cùng bộ test, cộng kiểm tra của nginx; cần `npm run build` và service `web` đang chạy;
                                         test cuối dùng hết lượt đăng nhập của máy, nên chờ một phút trước lần chạy kế tiếp)
Dựng bản đồ:    npm run build:map       (ghi lại src/map/vn-map.json; chạy khi file đường biên hoặc file seed địa danh đổi)
```

Test đầu-cuối tự build frontend rồi phục vụ bản build ở cổng 4173 (cổng này phải đang trống), nên nó thử đúng thứ sẽ được triển khai. Khi một lần chạy thất bại, đọc lỗi và thư mục `test-results/` trước khi chạy lại: lần chạy sau xoá chúng. Chromium của Playwright 1.60.0 đã có trên máy từ giai đoạn đo đạc; phiên bản `@playwright/test` được ghim đúng 1.60.0 để không phải tải trình duyệt khác.

### Bản triển khai trên máy

`docker compose ... up -d` bật thêm service `web` (nginx) ở `http://127.0.0.1:8080`: đây là địa chỉ để dùng webapp. Nó phát `frontend/dist`, nên phải chạy `npm run build` trước; chưa build thì trang trả 404. Build lại frontend không cần khởi động lại nginx. Sửa `deploy/nginx.conf` thì nạp lại bằng `docker compose -f deploy/docker-compose.yml exec web nginx -s reload`. Lý do của cấu hình ở `docs/decisions/ADR-006-*.md`.

## Project Structure

```
SPEC.md               → đặc tả tổng (file này)
specs/                → đặc tả từng module
tasks/plan.md         → kế hoạch triển khai
tasks/todo.md         → danh sách task, tiêu chí nghiệm thu, checkpoint
docs/decisions/       → ADR: lý do của các quyết định kiến trúc
deploy/               → docker-compose.yml, Dockerfile, nginx.conf (service `web`)
backend/app/          → mã backend, mỗi module một gói con (geo/, samples/, ...)
backend/migrations/   → migration Alembic
backend/tests/        → pytest
frontend/             → React: src/tree (cây, tip tạm), src/map (bản đồ), src/submit (form nộp mẫu), src/components, e2e
frontend/map-data/    → hai file đường biên và nguồn, giấy phép của chúng (NGUON.md)
frontend/scripts/     → script dựng file hình học của bản đồ
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

## API conventions

- JSON và tham số truy vấn dùng camelCase (`dateFrom`, `internalId`); mã Python dùng snake_case, chuyển đổi nằm ở lớp `ApiModel`.
- Mọi lỗi có một dạng: `{"error": {"code": "SAMPLE_NOT_FOUND", "message": "...", "details": [{"field": "...", "message": "..."}]}}`. `code` dành cho máy, giao diện dịch theo mã này; `details` chỉ có ở lỗi 422. Một mục của `details` có thể kèm `code` riêng của nó (ví dụ `SEQUENCE_TOO_SHORT`), để giao diện dịch được từng lỗi của form.
- Request ghi (POST, PUT, PATCH, DELETE) phải mang header `X-Requested-With`, khai `Content-Length`, và thân không quá 4 MB; không thì bị từ chối trước khi thân được đọc (403, 411, 413).
- Endpoint danh sách luôn phân trang: `{"items": [...], "total": n, "limit": l, "offset": o}`, `limit` tối đa 500.
- Thay đổi về sau chỉ thêm trường, không đổi nghĩa hay kiểu của trường đã có.
- Tài liệu tự sinh: `http://127.0.0.1:8000/api/docs`.

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
- **Không bao giờ:** push lên remote khi chủ repo chưa bảo; commit secret hoặc file dữ liệu; đưa chuỗi do người dùng nhập vào shell; tắt hoặc xoá test để bộ test qua; sửa file trong `D:\nextstrain\repos\`.

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
8. Commit sau mỗi lát cắt trên nhánh `feature/*`, gộp vào `main` khi module qua checkpoint. Repo có trên GitHub (`byteofcuong/vstrain`) từ 2026-10-13; push do chủ repo quyết định.

## Open Questions

1. Tên chính thức của dự án.
2. Các ngưỡng ở Success Criteria có đúng với kỳ vọng của bạn và của giảng viên hướng dẫn không.
3. (`accounts`) Ai được tạo tài khoản: chỉ admin, hay cho tự đăng ký?
4. (`submission`) Mẫu nộp qua web hiện công khai ngay khi đạt QC, hay cần admin duyệt?
5. (`geo`, `map`) Nguồn mã tỉnh chính thức và nguồn đường biên có giấy phép mở.
6. (`geo`) Vùng của 34 đơn vị mới: cách chia sáu vùng đã đổi sau sáp nhập, cần nguồn chính thức. Hiện đơn vị bộ 34 chưa được gán vùng.
