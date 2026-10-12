# Task list: VietStrain

Quy ước: `DC` là `docker compose -f deploy/docker-compose.yml`. Mỗi task xong khi đạt tiêu chí nghiệm thu **và** Definition of Done trong `SPEC.md`.

---

## Phase 1: `platform`

### T1.1 Walking skeleton
**Mô tả:** Dựng đường đi ngắn nhất qua toàn hệ thống: container DB và API khởi động được, API nối được DB, có khung test và lint.

**Nghiệm thu:**
- [x] `GET /api/health` trả 200 với `{"status": "ok", "db": "ok"}` khi DB chạy
- [x] Khi không nối được DB, trả 503 với `{"status": "degraded", "db": "down"}`

**Kiểm chứng:**
- [x] `DC run --rm api pytest`
- [x] `DC run --rm api ruff check .` và `ruff format --check .`
- [x] `DC up -d --build` rồi `curl -s http://127.0.0.1:8000/api/health`

**Phụ thuộc:** không. **Cỡ:** M (toàn file cấu hình).
**File:** `deploy/docker-compose.yml`, `deploy/api.Dockerfile`, `backend/requirements*.txt`, `backend/pyproject.toml`, `backend/app/{config,db,main}.py`, `backend/tests/test_health.py`

## Checkpoint A
- [x] Test qua, lint qua, health trả 200 khi chạy thật

---

## Phase 2: `geo`

### T2.1 `place_key()`: chuẩn hoá tên địa danh
**Mô tả:** Hàm thuần biến một tên địa danh thành khoá so khớp, để mọi cách viết của cùng một nơi cho cùng một khoá.

**Nghiệm thu:**
- [x] "Đắk Lắk", "Dak Lak", "DAKLAK", "dak-lak" cho cùng một khoá
- [x] Bỏ tiền tố và hậu tố hành chính: "Tỉnh Đắk Lắk", "TP. Hồ Chí Minh", "Thành phố Huế", "Dak Lak Province", "Ho Chi Minh City"
- [x] Không cắt nhầm tên thật: "Thanh Hoa" giữ nguyên chữ "thanh"; chuỗi rỗng hoặc toàn dấu cho khoá rỗng

**Kiểm chứng:** `DC run --rm api pytest tests/test_geo_normalize.py`
**Phụ thuộc:** T1.1. **Cỡ:** S.
**File:** `backend/app/geo/normalize.py`, `backend/tests/test_geo_normalize.py`

### T2.2 Bảng `admin_unit`, `place_alias` và khung migration
**Mô tả:** Thêm Alembic, migration đầu tiên tạo hai bảng địa danh, và database riêng cho test.

**Nghiệm thu:**
- [x] `alembic upgrade head` tạo `admin_unit` và `place_alias`; `alembic downgrade base` xoá sạch
- [x] `admin_unit` có mã, cấp, bộ đơn vị, tên tiếng Việt, tên tiếng Anh (với tỉnh là tên không dấu), đơn vị cha, đơn vị kế thừa, `valid_from`, `valid_to`
- [x] Test chạy trên database `vietstrain_test`, không đụng database chính

**Kiểm chứng:** `DC run --rm api pytest tests/test_geo_schema.py tests/test_migrations.py`; `DC up -d` (service `migrate` chạy `alembic upgrade head`)
**Phụ thuộc:** T1.1. **Cỡ:** M.
**File:** `backend/alembic.ini`, `backend/migrations/*`, `backend/app/models.py`, `backend/app/schema.py`, `backend/tests/{conftest,support}.py`, `backend/tests/test_geo_schema.py`, `backend/tests/test_migrations.py`, `deploy/docker-compose.yml`

### T2.3 Seed đơn vị hành chính và tên thay thế
**Mô tả:** Nạp 63 tỉnh (hiệu lực tới 30/6/2025), 34 đơn vị (từ 1/7/2025), 3 miền và 6 vùng, cùng các tên thay thế, từ file dữ liệu trong repo.

**Nghiệm thu:**
- [x] Sau khi seed: 63 đơn vị bộ `vn63`, 34 đơn vị bộ `vn34`, 9 vùng; mỗi tỉnh `vn63` có đúng một đơn vị kế thừa `vn34`
- [x] Chạy seed hai lần cho cùng kết quả (không nhân đôi, không lỗi)
- [x] Hai tên khác nhau trùng khoá mà trỏ tới hai đơn vị khác nhau thì seed báo lỗi rõ ràng

**Kiểm chứng:** `DC run --rm api pytest tests/test_geo_seed.py`; `DC run --rm init` (chạy `python -m app.cli init-db`: migration rồi seed)
**Phụ thuộc:** T2.1, T2.2. **Cỡ:** M.
**File:** `backend/app/geo/data/{*.tsv,NGUON.md}`, `backend/app/geo/seed.py`, `backend/app/cli.py`, `backend/tests/test_geo_seed.py`

### T2.4 `resolve_place()`: gán đơn vị theo tên và ngày
**Mô tả:** Từ địa danh gốc (division, location) và ngày lấy mẫu, trả về mã đơn vị, mã vùng và trạng thái.

**Nghiệm thu:**
- [ ] Ví dụ thật: "Nha Trang" → Khánh Hòa; "South" → miền Nam (cấp vùng); location "Hanoi" thắng division "Red River Delta"
- [ ] Theo ngày: "Binh Dinh" lấy mẫu năm 2010 → `vn63:binh-dinh`; lấy mẫu sau 1/7/2025 → đơn vị kế thừa `vn34:gia-lai`
- [ ] Trống → `missing`; có chữ nhưng không khớp → `unresolved`, giữ nguyên văn bản gốc

**Kiểm chứng:** `DC run --rm api pytest tests/test_geo_resolve.py`
**Phụ thuộc:** T2.3. **Cỡ:** M.
**File:** `backend/app/geo/resolve.py`, `backend/tests/test_geo_resolve.py`

## Checkpoint B
- [ ] Tiêu chí 4c: chạy 331 cách viết của 63 tỉnh, ≥ 95% ra đúng tỉnh; ghi kết quả vào `do-dac/results/`
- [ ] ADR-002 (địa danh) được viết

---

## Phase 3: `samples`

### T3.1 Bảng `sample`, `sample_sequence`; ngày không đầy đủ
**Mô tả:** Lưu mỗi mẫu thành một bản ghi có mã nội bộ; ngày lấy mẫu không đầy đủ được lưu thành khoảng.

**Nghiệm thu:**
- [ ] `parse_collection_date("2019-XX-XX")` → (2019-01-01, 2019-12-31); "2019-03-XX" → cả tháng 3; "2019-03-15" → một ngày; "XXXX-XX-XX" hoặc rỗng → không có ngày
- [ ] Mỗi mẫu có `internal_id` dạng `S0000123`, duy nhất, chỉ gồm chữ ASCII và số
- [ ] Địa danh gốc được lưu nguyên văn bên cạnh mã đã chuẩn hoá

**Kiểm chứng:** `DC run --rm api pytest tests/test_dates.py tests/test_samples_schema.py`
**Phụ thuộc:** T2.2. **Cỡ:** M.
**File:** `backend/app/samples/dates.py`, `backend/app/models.py`, `backend/migrations/versions/0002_*.py`, 2 file test

### T3.2 Lệnh nhập GenBank
**Mô tả:** Nhập file metadata TSV và FASTA do ingest của Nextstrain tạo ra; bản ghi Việt Nam được gán địa danh.

**Nghiệm thu:**
- [ ] Nhập bộ mẫu nhỏ cho đúng số bản ghi, đúng chuỗi, đúng trạng thái địa danh
- [ ] Chạy lại lệnh không tạo bản ghi trùng (khoá là accession)
- [ ] Bản ghi thiếu chuỗi hoặc thiếu accession bị đếm và báo cáo, không làm hỏng cả lô

**Kiểm chứng:** `DC run --rm api pytest tests/test_import_genbank.py`
**Phụ thuộc:** T2.4, T3.1. **Cỡ:** M.
**File:** `backend/app/samples/importer.py`, `backend/app/cli.py`, `backend/tests/test_import_genbank.py`, `backend/tests/fixtures/genbank_small.*`

### T3.3 Nhập dữ liệu thật và báo cáo địa danh
**Mô tả:** Nhập 59.551 bản ghi dengue; đo tỉ lệ gán địa danh cho 4.305 bản ghi Việt Nam.

**Nghiệm thu:**
- [ ] 59.551 bản ghi trong DB, trong đó 4.305 của Việt Nam
- [ ] Tiêu chí 4: ≥ 781 bản ghi gán được tỉnh; tiêu chí 4b: 2.306 gán được tỉnh hoặc vùng; không còn bản ghi `unresolved`

**Kiểm chứng:** `DC run --rm api python -m app.cli geo-report`; kết quả lưu ở `do-dac/results/`
**Phụ thuộc:** T3.2. **Cỡ:** S.
**File:** `backend/app/cli.py` (lệnh `geo-report`), file kết quả

### T3.4 API tra cứu mẫu
**Mô tả:** Endpoint trả danh sách mẫu theo bộ lọc, điều mà Nextstrain không làm được ở phía server.

**Nghiệm thu:**
- [ ] `GET /api/samples?unit=<mã>&date_from=&date_to=&limit=&offset=` trả đúng mẫu và tổng số; lọc theo đơn vị bộ 34 gồm cả mẫu của các tỉnh cũ đã sáp nhập vào nó
- [ ] `GET /api/samples/{internal_id}` trả một mẫu; mã không tồn tại → 404
- [ ] `limit` có trần (≤ 500); tham số sai → 422

**Kiểm chứng:** `DC run --rm api pytest tests/test_samples_api.py`; một lệnh `curl` trên dữ liệu thật
**Phụ thuộc:** T3.2. **Cỡ:** M.
**File:** `backend/app/samples/api.py`, `backend/app/main.py`, `backend/tests/test_samples_api.py`

## Checkpoint C (hết mốc M1)
- [ ] Tiêu chí 4, 4b, 4c đạt; số liệu ghi trong `do-dac/results/`
- [ ] Toàn bộ test và lint qua; nhánh `feature/*` được gộp vào `main`

---

## Phase 4: `job-queue` và Phase 5: `build`

Tiêu đề task ở `tasks/plan.md`. Tiêu chí nghiệm thu chi tiết được viết vào đây khi Checkpoint C xong, vì chúng phụ thuộc cấu trúc bảng `sample` thực tế.
