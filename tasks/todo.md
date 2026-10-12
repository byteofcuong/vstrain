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
- [x] Ví dụ thật: "Nha Trang" → Khánh Hòa; "South" → miền Nam (cấp vùng); location "Hanoi" thắng division "Red River Delta"
- [x] Theo ngày: "Binh Dinh" lấy mẫu năm 2010 → `vn63:binh-dinh`; lấy mẫu từ 1/7/2025, hoặc không rõ ngày → đơn vị kế thừa `vn34:gia-lai`
- [x] Trống → `missing`; có chữ nhưng không khớp → `unresolved`, giữ nguyên văn bản gốc

**Kiểm chứng:** `DC run --rm api pytest tests/test_geo_resolve.py`
**Phụ thuộc:** T2.3. **Cỡ:** M.
**File:** `backend/app/geo/resolve.py`, `backend/tests/test_geo_resolve.py`

## Checkpoint B
- [x] Tiêu chí 4c: chạy 331 cách viết của 63 tỉnh, ≥ 95% ra đúng tỉnh; ghi kết quả vào `do-dac/results/` → 320/331 (96,7%) chỉ nhờ chuẩn hoá, 331/331 khi có bảng tên thay thế đầy đủ (`do-dac/results/W1-dia-danh-webapp/`)
- [x] ADR-002 (địa danh) được viết

---

## Phase 3: `samples`

### T3.1 Bảng `sample`, `sample_sequence`; ngày không đầy đủ
**Mô tả:** Lưu mỗi mẫu thành một bản ghi có mã nội bộ; ngày lấy mẫu không đầy đủ được lưu thành khoảng.

**Nghiệm thu:**
- [x] `parse_collection_date("2019-XX-XX")` → (2019-01-01, 2019-12-31); "2019-03-XX" → cả tháng 3; "2019-03-15" → một ngày; "XXXX-XX-XX" hoặc rỗng → không có ngày
- [x] Mỗi mẫu có `internal_id` dạng `S0000123`, duy nhất, chỉ gồm chữ ASCII và số
- [x] Địa danh gốc được lưu nguyên văn bên cạnh mã đã chuẩn hoá

**Kiểm chứng:** `DC run --rm api pytest tests/test_dates.py tests/test_samples_schema.py`
**Phụ thuộc:** T2.2. **Cỡ:** M.
**File:** `backend/app/samples/dates.py`, `backend/app/models.py`, `backend/migrations/versions/0002_*.py`, 2 file test

### T3.2 Lệnh nhập GenBank
**Mô tả:** Nhập file metadata TSV và FASTA do ingest của Nextstrain tạo ra; bản ghi Việt Nam được gán địa danh.

**Nghiệm thu:**
- [x] Nhập bộ mẫu nhỏ cho đúng số bản ghi, đúng chuỗi, đúng trạng thái địa danh
- [x] Chạy lại lệnh không tạo bản ghi trùng (khoá là accession)
- [x] Bản ghi thiếu chuỗi hoặc thiếu accession bị đếm và báo cáo, không làm hỏng cả lô

**Kiểm chứng:** `DC run --rm api pytest tests/test_import_genbank.py`
**Phụ thuộc:** T2.4, T3.1. **Cỡ:** M.
**File:** `backend/app/samples/importer.py`, `backend/app/cli.py`, `backend/tests/test_import_genbank.py` (dữ liệu thử được viết ngay trong từng test)

### T3.3 Nhập dữ liệu thật và báo cáo địa danh
**Mô tả:** Nhập 59.551 bản ghi dengue; đo tỉ lệ gán địa danh cho 4.305 bản ghi Việt Nam.

**Nghiệm thu:**
- [x] 59.551 bản ghi trong DB, trong đó 4.305 của Việt Nam
- [x] Tiêu chí 4: ≥ 781 bản ghi gán được tỉnh; tiêu chí 4b: 2.306 gán được tỉnh hoặc vùng; không còn bản ghi `unresolved` → 782 (18,2%) ra tỉnh, 2.306 (53,6%) ra tỉnh hoặc vùng, 0 `unresolved`

**Kiểm chứng:** `DC run --rm api python -m app.cli geo-report`; kết quả lưu ở `do-dac/results/`
**Phụ thuộc:** T3.2. **Cỡ:** S.
**File:** `backend/app/samples/report.py`, `backend/app/cli.py` (lệnh `geo-report`), kết quả ở `do-dac/results/W2-nhap-mau-webapp/`

### T3.4 API tra cứu mẫu
**Mô tả:** Endpoint trả danh sách mẫu theo bộ lọc, điều mà Nextstrain không làm được ở phía server.

**Nghiệm thu:**
- [x] `GET /api/samples?unit=<mã>&dateFrom=&dateTo=&limit=&offset=` trả đúng mẫu và tổng số; lọc theo đơn vị bộ 34 gồm cả mẫu của các tỉnh cũ đã sáp nhập vào nó
- [x] `GET /api/samples/{internal_id}` trả một mẫu; mã không tồn tại → 404
- [x] `limit` có trần (≤ 500); tham số sai → 422

**Kiểm chứng:** `DC run --rm api pytest tests/test_samples_api.py`; một lệnh `curl` trên dữ liệu thật
**Phụ thuộc:** T3.2. **Cỡ:** M.
**File:** `backend/app/samples/{api,queries,schemas}.py`, `backend/app/{errors,apimodel,main}.py`, `backend/tests/test_samples_api.py`

## Checkpoint C (hết mốc M1)
- [x] Tiêu chí 4, 4b, 4c đạt; số liệu ghi trong `do-dac/results/`
- [x] Toàn bộ test và lint qua; nhánh `feature/*` được gộp vào `main`

---

## Phase 4: `job-queue`

### T4.1 Bảng `job`, `job_step`; `enqueue()` và `claim()`
**Mô tả:** Hàng đợi job là một bảng trong PostgreSQL. Worker lấy job bằng `FOR UPDATE SKIP LOCKED` nên nhiều worker không lấy trùng.

**Nghiệm thu:**
- [x] `enqueue` tạo job `queued`; `claim` trả job ưu tiên cao nhất, cũ nhất trước, đổi sang `running`, ghi tên worker và giờ bắt đầu
- [x] 4 luồng cùng `claim` 20 job trên kết nối thật: mỗi job được lấy đúng một lần
- [x] `finish` ghi `succeeded` kèm kết quả; `fail` ghi `failed` kèm lỗi; hàng đợi trống thì `claim` trả `None`

**Kiểm chứng:** `DC run --rm api pytest tests/test_job_queue.py`
**Phụ thuộc:** T2.2. **Cỡ:** M.
**File:** `backend/app/models.py`, `backend/migrations/versions/0003_*.py`, `backend/app/jobs/queue.py`, `backend/tests/test_job_queue.py`

### T4.2 `run_tool()`: gọi công cụ ngoài không qua shell
**Mô tả:** Một chỗ duy nhất được phép chạy tiến trình ngoài. Đây là câu trả lời cho việc Augur ghép lệnh thành chuỗi bash.

**Nghiệm thu:**
- [x] Lệnh là danh sách đối số: đối số `; touch x` hay `$(touch x)` được truyền nguyên văn, không file nào được tạo
- [x] Chỉ chạy công cụ trong danh sách cho phép; tên khác bị từ chối trước khi chạy
- [x] Quá thời gian thì tiến trình và tiến trình con bị dừng (`ToolTimeout`); mã thoát khác 0 thì `ToolFailed` kèm đuôi log
- [x] Trả về thời gian chạy, CPU time và đỉnh bộ nhớ; log ghi ra file; tiến trình con không thấy biến môi trường chứa URL database

**Kiểm chứng:** `DC run --rm api pytest tests/test_run_tool.py`
**Phụ thuộc:** không. **Cỡ:** M.
**File:** `backend/app/jobs/tools.py`, `backend/tests/test_run_tool.py`

### T4.3 Worker, bước của job, image worker
**Mô tả:** Tiến trình worker lấy job, chạy handler theo loại job, ghi từng bước vào DB để giao diện thấy tiến độ.

**Nghiệm thu:**
- [x] Mỗi bước có một dòng `job_step` (tên, trạng thái, bắt đầu, kết thúc, số đo, đuôi log), đọc được khi job còn đang chạy
- [x] Handler ném lỗi thì job thành `failed` và worker chạy tiếp; loại job lạ thì `failed`
- [x] Job `running` mà worker ngừng báo nhịp quá 90 giây được đánh dấu `failed`
- [x] Service `worker` trong Compose (image dẫn xuất từ `nextstrain/base`, chạy bằng user thường) xử lý job `tool_versions`, kết quả ghi phiên bản augur, nextclade, iqtree

**Kiểm chứng:** `DC run --rm api pytest tests/test_job_steps.py tests/test_worker.py`; `DC up -d --build` rồi `DC run --rm api python -m app.cli enqueue tool_versions` và xem dòng `job`
**Phụ thuộc:** T4.1, T4.2. **Cỡ:** M.
**File:** `backend/app/jobs/{steps,worker,handlers}.py` (worker chạy bằng `python -m app.jobs.worker`), `deploy/worker.Dockerfile`, `deploy/docker-compose.yml`, `backend/app/cli.py`, 2 file test

## Checkpoint (hết Phase 4)
- [x] ADR-003 (mã nội bộ, gọi công cụ bằng danh sách đối số) và ADR-004 (bước pipeline là hàm Python có trạng thái trong DB) được viết
- [x] Một job thật chạy trong container worker, từ lúc xếp hàng tới lúc có kết quả

---

## Phase 5: `build`

Test của phase này chạy công cụ thật (Nextclade, IQ-TREE, Augur) nên chạy trong image worker: `DC run --rm worker pytest -m tools`.

### T5.1 Cấu hình pathogen; gióng và QC một lô mẫu bằng Nextclade
**Mô tả:** Mỗi mẫu được gióng theo reference đúng một lần và kết quả được lưu lại; build về sau chỉ ghép các chuỗi đã gióng.

**Nghiệm thu:**
- [ ] Cấu hình dengue có bốn lineage (`denv1` tới `denv4`), mỗi lineage có reference, annotation và định nghĩa clade; nguồn ghi trong `NGUON.md`
- [ ] `align_batch` chạy Nextclade trên một lô mẫu; file FASTA đưa cho công cụ chỉ chứa mã nội bộ; chuỗi đã gióng dài đúng bằng reference và được lưu cùng số nucleotide hợp lệ
- [ ] Mẫu không gióng được (khác serotype, quá ngắn) được ghi `failed` kèm lý do và không làm hỏng lô
- [ ] Mẫu tên "Hà_Nội/01/2024" đi qua bước này

**Kiểm chứng:** `DC run --rm worker pytest -m tools tests/test_align.py`
**Phụ thuộc:** T4.3, T3.1. **Cỡ:** M.
**File:** `backend/app/pathogens/*`, `backend/app/build/align.py`, `backend/app/models.py`, migration, `backend/tests/test_align.py`

### T5.2 Gióng toàn bộ genome đã nhập
**Mô tả:** Job nền gióng mọi mẫu có serotype và đủ dài mà chưa có kết quả.

**Nghiệm thu:**
- [ ] Job `align_pending` chia lô, mỗi lô là một bước; chạy lại thì chỉ làm phần còn thiếu
- [ ] Số mẫu `aligned` và `failed` theo lineage cùng thời gian chạy được ghi vào `do-dac/results/`

**Kiểm chứng:** `DC run --rm api python -m app.cli enqueue align_pending` rồi xem `job`, `job_step`
**Phụ thuộc:** T5.1. **Cỡ:** S.

### T5.3 `dataset_def`, `build`; chọn mẫu cho một dataset
**Mô tả:** Một dataset là một quy tắc chọn mẫu có trần; mỗi lần build ghi lại đúng những mẫu nó dùng.

**Nghiệm thu:**
- [ ] Chọn mọi mẫu Việt Nam đạt điều kiện của lineage, rồi thêm mẫu bối cảnh thế giới chia đều theo (nước, năm) cho tới trần
- [ ] Cùng dữ liệu cho cùng tập mẫu; thêm một mẫu mới thì các mẫu bối cảnh đã chọn gần như giữ nguyên
- [ ] Chỉ nhận mẫu có ít nhất năm lấy mẫu và ít nhất 10.000 nucleotide hợp lệ
- [ ] Mỗi dataset có nhiều nhất một build hiện hành (ràng buộc trong DB)

**Kiểm chứng:** `DC run --rm api pytest tests/test_build_selection.py`
**Phụ thuộc:** T5.1. **Cỡ:** M.

### T5.4 Các bước dựng cây, chạy trên bộ nhỏ
**Mô tả:** Job `build_dataset` chạy các bước `prepare`, `tree`, `refine`, `ancestral`, `translate`, `clades`, `export` bằng `run_tool`.

**Nghiệm thu:**
- [ ] Build khoảng 30 mẫu chạy hết các bước; mỗi bước có dòng `job_step` kèm thời gian, CPU time, đỉnh bộ nhớ
- [ ] Không có bước gióng hàng; alignment được ghép từ chuỗi đã lưu
- [ ] File đưa cho công cụ chỉ có mã nội bộ và ngày lấy mẫu; không có tên hiển thị hay địa danh
- [ ] Cây Auspice v2 xuất ra dùng được làm cây nền cho Nextclade: đặt thử một mẫu ngoài build thành công
- [ ] Tiêu chí 5: mẫu tên "Hà_Nội/01/2024" có mặt trong cây. Tiêu chí 5b: tham số chứa `; touch <file>` không tạo file

**Kiểm chứng:** `DC run --rm worker pytest -m tools tests/test_build_pipeline.py`
**Phụ thuộc:** T5.3. **Cỡ:** L (chia nhỏ khi làm, mỗi phần một commit).

### T5.5 Định dạng cột, publish theo hash, `GET /api/datasets`
**Mô tả:** Kết quả build được xuất thành hai dạng: Auspice v2 JSON (tương thích) và dạng cột cho viewer; thuộc tính của tip lấy từ DB lúc publish.

**Nghiệm thu:**
- [ ] `tree.json` là các mảng song song theo thứ tự duyệt trước (cha luôn đứng trước con); số node, quan hệ cha con, độ phân kỳ và ngày khớp với cây Auspice
- [ ] Mỗi thuộc tính của tip là một file cột mã hoá từ điển, sinh từ DB; sửa địa danh rồi publish lại không cần dựng lại cây
- [ ] Thư mục publish đặt tên theo hash nội dung; build mới thành hiện hành trong một transaction; build cũ còn nguyên
- [ ] `GET /api/datasets` và `GET /api/datasets/{slug}` trả dataset cùng build hiện hành và đường dẫn manifest

**Kiểm chứng:** `DC run --rm api pytest tests/test_columnar.py tests/test_datasets_api.py`; `curl` trên build thật
**Phụ thuộc:** T5.4. **Cỡ:** M.

### T5.6 Build thật cho DENV1; so thời gian với P1
**Nghiệm thu:**
- [ ] Build 2.000 mẫu chạy xong, có dòng `build` hiện hành và bộ file publish
- [ ] Tiêu chí 2: bảng thời gian từng bước so với P1 (771 s, trong đó `align` 72 s), ghi vào `do-dac/results/`

**Kiểm chứng:** truy vấn `job_step`; `curl http://127.0.0.1:8000/api/datasets`
**Phụ thuộc:** T5.2, T5.5. **Cỡ:** S.

## Checkpoint D (hết mốc M2): dừng lại để bạn xem
- [ ] Tiêu chí 2, 5 và 5b đạt
- [ ] ADR-005 (gióng từng mẫu một lần) được viết
- [ ] Trình bày kết quả, đặc tả module `viewer`, `accounts`, `submission` và các câu hỏi mở
- [ ] Xin phép cài dependency cho frontend
