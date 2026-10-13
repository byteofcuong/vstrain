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
- [x] Cấu hình dengue có bốn lineage (`denv1` tới `denv4`), mỗi lineage có reference, annotation và định nghĩa clade; nguồn ghi trong `NGUON.md`
- [x] `align_batch` chạy Nextclade trên một lô mẫu; file FASTA đưa cho công cụ chỉ chứa mã nội bộ; chuỗi đã gióng dài đúng bằng reference và được lưu cùng số nucleotide hợp lệ
- [x] Mẫu không gióng được được ghi `failed` kèm lý do và không làm hỏng lô. Nextclade vẫn gióng được genome khác serotype (khoảng 31% vị trí khác reference), nên có thêm ngưỡng phân kỳ 15%; đoạn gene ngắn vẫn gióng được nhưng có ít nucleotide hợp lệ nên không vào build
- [x] Mẫu tên "Hà_Nội/01/2024" đi qua bước này

**Kiểm chứng:** `DC run --rm worker pytest -m tools tests/test_align.py`
**Phụ thuộc:** T4.3, T3.1. **Cỡ:** M.
**File:** `backend/app/pathogens/*`, `backend/app/build/align.py`, `backend/app/models.py`, migration, `backend/tests/test_align.py`

### T5.2 Gióng toàn bộ genome đã nhập
**Mô tả:** Job nền gióng mọi mẫu có serotype và đủ dài mà chưa có kết quả.

**Nghiệm thu:**
- [x] Job `align_pending` chia lô, mỗi lô là một bước; chạy lại thì chỉ làm phần còn thiếu
- [x] Số mẫu `aligned` và `failed` theo lineage cùng thời gian chạy được ghi vào `do-dac/results/` → 21.909 genome trong một job 34 giây (Nextclade chạy 17 giây); 21.892 gióng được, 17 không; DENV1 có 7.988 genome đủ điều kiện, 1.621 của Việt Nam (`do-dac/results/W3-giong-mau-webapp/`)

**Kiểm chứng:** `DC run --rm api python -m app.cli enqueue align_pending` rồi xem `job`, `job_step`
**Phụ thuộc:** T5.1. **Cỡ:** S.

### T5.3 `dataset_def`, `build`; chọn mẫu cho một dataset
**Mô tả:** Một dataset là một quy tắc chọn mẫu có trần; mỗi lần build ghi lại đúng những mẫu nó dùng.

**Nghiệm thu:**
- [x] Chọn mẫu Việt Nam đạt điều kiện của lineage trước (tối đa 75% trần, để luôn còn chỗ cho bối cảnh), rồi thêm mẫu bối cảnh thế giới chia đều theo (nước, năm) cho tới trần
- [x] Cùng dữ liệu cho cùng tập mẫu; thêm một mẫu mới thì các mẫu bối cảnh đã chọn gần như giữ nguyên
- [x] Chỉ nhận mẫu có ít nhất năm lấy mẫu và ít nhất 10.000 nucleotide hợp lệ
- [x] Mỗi dataset có nhiều nhất một build hiện hành (ràng buộc trong DB)

**Kiểm chứng:** `DC run --rm api pytest tests/test_build_selection.py`
**Phụ thuộc:** T5.1. **Cỡ:** M.
**File:** `backend/app/build/{selection,datasets}.py`, `backend/app/models.py`, `backend/migrations/versions/0005_*.py`, `backend/tests/test_build_selection.py`
**Trên dữ liệu thật:** `dengue-denv1` với trần 2.000 chọn 1.500 mẫu Việt Nam (trong 1.578 mẫu đủ điều kiện) và 500 mẫu bối cảnh từ 91 nước, mất 0,09 giây.

### T5.4 Các bước dựng cây, chạy trên bộ nhỏ
**Mô tả:** Job `build_dataset` chạy các bước `prepare`, `tree`, `refine`, `ancestral`, `translate`, `clades`, `export` bằng `run_tool`.

**Nghiệm thu:**
- [x] Build khoảng 30 mẫu chạy hết các bước; mỗi bước có dòng `job_step` kèm thời gian, CPU time, đỉnh bộ nhớ
- [x] Không có bước gióng hàng; alignment được ghép từ chuỗi đã lưu
- [x] File đưa cho công cụ chỉ có mã nội bộ và ngày lấy mẫu; không có tên hiển thị hay địa danh
- [x] Cây Auspice v2 xuất ra dùng được làm cây nền cho Nextclade: đặt thử một mẫu ngoài build thành công
- [x] Tiêu chí 5: mẫu tên "Hà_Nội/01/2024" có mặt trong cây. Tiêu chí 5b: tham số chứa `; touch <file>` không tạo file

**Kiểm chứng:** `DC run --rm worker pytest -m tools tests/test_build_pipeline.py`
**Phụ thuộc:** T5.3. **Cỡ:** L (chia nhỏ khi làm, mỗi phần một commit).
**File:** `backend/app/build/{inputs,pipeline}.py`, `backend/app/pathogens/__init__.py`, `backend/migrations/versions/0006_*.py`, `backend/tests/test_build_{inputs,pipeline}.py`

### T5.5 Định dạng cột, publish theo hash, `GET /api/datasets`
**Mô tả:** Kết quả build được xuất thành hai dạng: Auspice v2 JSON (tương thích) và dạng cột cho viewer; thuộc tính của tip lấy từ DB lúc publish.

**Nghiệm thu:**
- [x] `tree.json` là các mảng song song theo thứ tự duyệt trước (cha luôn đứng trước con); số node, quan hệ cha con, độ phân kỳ và ngày khớp với cây Auspice
- [x] Mỗi thuộc tính của tip là một file cột mã hoá từ điển, sinh từ DB; sửa địa danh rồi publish lại không cần dựng lại cây
- [x] Thư mục publish đặt tên theo hash nội dung; build mới thành hiện hành trong một transaction; build cũ còn nguyên
- [x] `GET /api/datasets` và `GET /api/datasets/{slug}` trả dataset cùng build hiện hành và đường dẫn manifest

**Kiểm chứng:** `DC run --rm api pytest tests/test_columnar.py tests/test_publish.py tests/test_datasets_api.py`; `curl` trên build thật (ở T5.6)
**Phụ thuộc:** T5.4. **Cỡ:** M.
**File:** `backend/app/build/{columnar,publish,api}.py`, `backend/app/build/pipeline.py` (bước `publish`, job `publish_build`), `backend/migrations/versions/0007_*.py`, 3 file test

### T5.6 Build thật cho DENV1; so thời gian với P1
**Nghiệm thu:**
- [x] Build 2.000 mẫu chạy xong, có dòng `build` hiện hành và bộ file publish → job 4, 682 s, 1.964 tip, publish ở `dengue-denv1/b000001/p-40c9b4f4f6f1`
- [x] Tiêu chí 2: bảng thời gian từng bước so với P1 (771 s, trong đó `align` 72 s), ghi vào `do-dac/results/` → trên đúng tập mẫu của P1: 755 s so với 771 s; bước gióng mất đi 77 s, nhưng `refine` chậm hơn 75 s trong lần chạy đó (`do-dac/results/W4-build-webapp/`, `TIEN-DO.md` mục 15)

**Kiểm chứng:** truy vấn `job_step`; `curl http://127.0.0.1:8000/api/datasets`
**Phụ thuộc:** T5.2, T5.5. **Cỡ:** S.

### T5.7 Sửa lỗi theo review độc lập (hàng đợi job, gọi công cụ, đầu vào build)
**Nghiệm thu:**
- [x] Worker không chết khi ghi kết quả lỗi hoặc gặp lỗi ngoài handler; job đã bị đánh dấu thất bại không bị ghi đè thành thành công
- [x] Byte NUL trong log và thông báo lỗi không làm hỏng việc ghi DB; job quá thời gian giữ được đuôi log
- [x] Job có tham số lạ bị từ chối; chuỗi có ký tự không phải nucleotide không tới công cụ; `/builds/` chỉ phát đúng dạng đường dẫn của bản publish

**Kiểm chứng:** 14 test mới thất bại trên mã cũ; `DC run --rm worker pytest` → 267 passed; `DC run --rm api pytest` → 255 passed, 12 skipped (commit `810197d`)

## Checkpoint D (hết mốc M2): dừng lại để bạn xem
- [x] Tiêu chí 5 và 5b đạt
- [x] Tiêu chí 2 (build N = 2.000 không chậm hơn 771 s, không có bước gióng): đạt sát ngưỡng. Ba lần chạy trên đúng tập mẫu của P1: 755, 770, 770 s. Build không nhanh hơn P1: phần gióng tiết kiệm được (77 s) bị `refine` chậm hơn ăn hết (xem `TIEN-DO.md` mục 15, ADR-005)
- [x] ADR-005 (gióng từng mẫu một lần) được viết
- [x] Trình bày kết quả, đặc tả module `viewer`, `accounts`, `submission` và các câu hỏi mở (các câu hỏi mở đang dùng phương án đề xuất, ghi ở cuối file này)
- [x] Xin phép cài dependency cho frontend (đồng ý ngày 2026-10-12, Node 24 portable)

---

## Việc còn lại trước mốc M3

Mỗi mục một việc, một lệnh kiểm chứng, một commit. Làm xong một nhóm thì dừng chờ.

**Nhóm đóng Checkpoint D**
- [x] D1: chạy lại build 2 lần trên tập mẫu của P1, và chạy `refine` của webapp trên đầu vào của P1 (W4b). Kết quả: chênh lệch không phải nhiễu (649, 659, 660 s so với 570–584 s của P1); ít nhất 54 s đến từ đầu vào. Số liệu ở `do-dac/results/W4-build-webapp/`
- [x] D2: commit ba bản đặc tả nháp trong `specs/`; gộp `feature/build` vào `main` (`df60514`)
- [ ] D3 (việc của bạn, không chặn việc đang làm): đọc `specs/SPEC-accounts.md`, `SPEC-submission.md` và mục "Quyết định cho các câu hỏi mở" ở cuối file; đổi chỗ nào thì báo. Dependency frontend đã được đồng ý

**Nhóm dọn nợ kỹ thuật backend** (từ review, chưa sửa; mỗi mục cỡ S)
- [x] N1: worker rảnh thì dọn thư mục làm việc của job đã kết thúc quá 7 ngày (`60c63f0`)
- [x] N2: publish xoá thư mục `.tmp-*` còn sót của lần chạy hỏng, trừ thư mục mới hơn một giờ (`e66b4ac`)
- [x] N3: IQ-TREE nhận seed cố định từ cấu hình lineage (`4ea3436`). Kiểm chứng: test đọc dòng `Seed:` trong log của IQ-TREE. Chưa kiểm chứng rằng hai lần build cho đúng cùng một cây: IQ-TREE chọn số luồng tự động (`-T AUTO`), và số luồng khác nhau có thể cho kết quả khác nhau dù cùng seed

---

## Phase 6: `viewer` (mốc M3)

Đặc tả: `specs/SPEC-viewer.md`. Dependency frontend đã được đồng ý ngày 2026-10-12 (Node 24 portable ở `do-dac/tools/node24`, không đụng Node của máy). Lệnh chạy trong `frontend/`: `npm run test` (vitest), `npm run lint`, `npm run build`, `npm run e2e` (Playwright).

- [x] T6.1 Khung Vite + React + TypeScript; lint, format, vitest chạy được; trang danh sách dataset đọc `GET /api/datasets`. Kiểm chứng: `npm run test`, `npm run lint`, `npm run build`
- [x] T6.2 Lõi dữ liệu cây ngoài React: đọc `tree.json` thành typed array, kiểm tra tính hợp lệ (cha đứng trước con, độ dài mảng khớp). Kiểm chứng: vitest trên một cây nhỏ viết tay và một cây ngẫu nhiên 5.000 tip; file thật của DENV1 được test đầu-cuối đọc
- [x] T6.3 Bố cục chữ nhật (trục thời gian và trục độ phân kỳ) trong hệ toạ độ [0, 1] × [0, 1]; phép biến đổi sang pixel (vừa khít, phóng quanh con trỏ, kéo, giới hạn). Kiểm chứng: vitest so với kết quả tính tay
- [x] T6.4 Web Worker tải manifest, cây, cột; trả typed array bằng transfer; cột tải lỗi thì báo và cho thử lại. Kiểm chứng: vitest cho phần thuần (tên file trong manifest, đối chiếu số node, cột); Playwright cho luồng thật và cho trường hợp một cột tải lỗi
- [x] T6.5 Vẽ Canvas: nhánh và tip, gộp tip trùng pixel; phóng to, thu nhỏ, kéo; trục vẽ trên canvas. Kiểm chứng: Playwright mở DENV1, có khung hình, số tip khớp manifest (tiêu chí V2)
- [x] T6.6 Tô màu theo cột (tối đa tám màu, phần còn lại gộp thành "giá trị khác") và chú giải. Kiểm chứng: vitest cho việc gán màu; bảng màu qua `validate_palette.js` của quy trình dataviz
- [x] T6.7 Lọc theo khoảng ngày và theo giá trị cột; tìm mẫu theo tên hoặc accession. Kiểm chứng: vitest cho mặt nạ lọc và hàm tìm; Playwright so số mẫu còn hiện với số tính từ file cột
- [x] T6.8 Lưới không gian tìm tip dưới con trỏ; tooltip; bấm mở bảng chi tiết mẫu. Kiểm chứng: Playwright rê chuột và bấm 100 tip ngẫu nhiên, ra đúng mẫu cả 100 lần (tiêu chí 3c)
- [x] T6.9 Bố cục toả tròn. Kiểm chứng: vitest; Playwright đổi bố cục và trục, không mất tip nào
- [x] T6.10 Song ngữ Việt, Anh; đổi ngôn ngữ không tải lại dữ liệu (tiêu chí V3). Kiểm chứng: Playwright đếm request sau khi đổi ngôn ngữ (0)
- [x] T6.11 Đo tiêu chí 3, 3b, V1 trên dataset 35 nghìn và 100 nghìn tip. Số liệu ở `do-dac/results/W5-viewer-webapp/`, diễn giải ở `do-dac/bao-cao/TIEN-DO.md` mục 16
- [x] T6.12 Service `web` (nginx 1.28) ở cổng 8080 phục vụ frontend đã build và thư mục publish, chuyển `/api` sang `api` (ADR-006). Kiểm chứng: `npm run e2e:web` → 14 passed (9 test của viewer chạy qua nginx với CSP bật, 5 test của cấu hình nginx); sửa thử 15 chỗ trong `nginx.conf`, cả 15 bị test bắt. Khác kế hoạch: nén gzip lúc phát thay vì nén sẵn brotli (image nginx chính thức không có brotli; với dataset có trần 2.000 mẫu, nén lúc phát tốn 10–30 ms cho lần tải đầu)

**Kết quả kiểm chứng của T6.1–T6.10 (2026-10-13):** `npm run test` → 97 passed; `npm run typecheck`, `npm run lint` sạch; `npm run e2e` → 9 passed trên bản build, với dataset DENV1 thật (1.964 tip).

**Kết quả của T6.11 (2026-10-13, commit `a575ac2`; Chromium headless, 5 lần mỗi dataset):**

| Tiêu chí | Ngưỡng | Đo được | Đạt |
|---|---|---|---|
| 3: khung hình đầu ở 35 nghìn tip | ≤ 1 s | 313 ms (trung vị; 463 / 313 / 306 / 327 / 312) | có |
| 3b: lọc theo ngày, đổi cột màu ở 35 nghìn tip | main thread bận ≤ 100 ms, không task trên 50 ms | bận nhiều nhất 67,7 ms; task dài nhất 44,1 ms | có |
| V1: dataset 100 nghìn tip mở được | có khung hình, không lỗi | khung hình đầu 464 ms; 0 lỗi; 14 thao tác chạy xong ở cả 5 lần | có |

- Các số trên đo bản build do `vite preview` phục vụ (không nén). Qua service `web` (nginx, nén gzip lúc phát), khung hình đầu là 418 ms ở 35 nghìn tip và 804 ms ở 100 nghìn tip; tiêu chí 3 và 3b vẫn đạt.
- Ngoài phạm vi tiêu chí 3b: lần đầu đổi sang bố cục toả tròn trong một phiên có một task 51–77 ms ở 35 nghìn tip.
- Bộ vẽ được tối ưu trong lúc đo (`33d6f18`, `fa8e40a`, `a575ac2`): chỉ vẽ nét thêm pixel mới, tip nhỏ vẽ thành ô 2 × 2 pixel, bố cục toả tròn bỏ nhánh ngoài khung nhìn, mỗi lượt màu chỉ duyệt node của màu đó. Khi kéo cây liên tục ở 35 nghìn tip, main thread cần 12–25 ms cho một khung hình (trước: 21–37 ms); ở 100 nghìn tip 22–38 ms (trước: 44–94 ms).
- Kiểm chứng sau các thay đổi này: `npm run test` → 142 passed; `npm run typecheck`, `npm run lint` sạch; `npm run e2e` → 9 passed. Mutation check trên `draw.ts`: 59 chỗ sửa, 57 bị test bắt; 2 chỗ còn lại không đổi hình vẽ.
- Chưa làm: bỏ qua cả cây con nằm ngoài khung nhìn (mỗi khung hình vẫn duyệt mọi node); phần raster nằm ngoài hàm vẽ (7–17 ms mỗi khung hình ở 35 nghìn tip); đo trên Chrome có GPU, mạng chậm, CPU chậm.

**Đã biết, chưa giải thích được:** một lần chạy `npm run e2e` (khi còn chạy trên dev server) có 1 test thất bại (lọc theo chú giải); chạy lại 112 lượt test liên tiếp không tái hiện, log của API không có request nào lỗi, và đầu ra của lần hỏng không được giữ lại. Từ nay đầu ra của test đầu-cuối luôn được ghi ra file.

## Checkpoint E (hết mốc M3)
- [x] Tiêu chí 3, 3b, 3c, V1, V2, V3 có số đo (bảng dưới)
- [x] Ảnh chụp màn hình viewer với dataset DENV1 thật: năm ảnh ở `do-dac/results/W5-viewer-webapp/anh/`, chụp qua service `web` bằng `do-dac/scripts/w5-viewer/chup_man_hinh.mjs`

| Tiêu chí | Ngưỡng | Kết quả | Nguồn |
|---|---|---|---|
| 3 | khung hình đầu ≤ 1 s ở 35 nghìn tip | 313 ms; 418 ms qua nginx | T6.11 |
| 3b | lọc theo ngày, đổi cột màu ở 35 nghìn tip: main thread bận ≤ 100 ms, không task trên 50 ms | bận nhiều nhất 67,7 ms; task dài nhất 44,1 ms | T6.11 |
| 3c | rê chuột và bấm 100 tip ngẫu nhiên, ra đúng mẫu | 100 / 100; ngày trên cây của cả 100 mẫu nằm trong ngày lấy mẫu đã khai | test `(criterion 3c)` |
| V1 | dataset 100 nghìn tip mở được, không lỗi | khung hình đầu 464 ms; 0 lỗi | T6.11 |
| V2 | số tip, khoảng ngày, màu theo cột khớp file publish | 1.964 tip; giới hạn của hai ô chọn ngày là ngày của tip sớm nhất và muộn nhất; danh sách cột và số đếm trong chú giải khớp manifest và file cột | ba test `(criterion V2)` |
| V3 | đổi ngôn ngữ không tải lại dữ liệu | 0 request | test `(criterion V3)` |

**Kiểm chứng lúc đóng checkpoint (2026-10-13, commit `d32f469`):** `npm run test` → 148 passed; `npm run typecheck`, `npm run lint` sạch; `npm run e2e` → 12 passed; `npm run e2e:web` → 17 passed (12 test của viewer qua nginx, 5 test của cấu hình nginx).

**Hai lỗi tìm ra khi đối chiếu tiêu chí V2 với file publish, đã sửa (`d32f469`):**
- **Ngày trên cây lệch một ngày.** Trong `tree.json`, tip nằm ở giữa ngày lấy mẫu (quy ước của TreeTime) và `augur export` làm tròn 3 chữ số thập phân; viewer lại làm tròn tới nửa đêm gần nhất. Trên build DENV1, 606 trong 1.964 tip hiện một ngày nằm ngoài ngày lấy mẫu đã khai (352 trong 773 mẫu có ngày đầy đủ bị muộn một ngày; mẫu chỉ khai năm 1971 hiện 1972-01-01). Sau khi sửa: 0.
- **Bộ lọc "Đến ngày" làm rơi tip ở cuối ngày.** Cận trên đặt ở 99% của ngày được chọn, nên tip có thời điểm rơi vào mấy phút cuối ngày bị loại (3 tip của build DENV1). Nay bộ lọc giữ hai ngày dạng chữ và đổi sang một khoảng thời điểm khớp với cách viewer gọi tên ngày.
- Test cũ của V2 chỉ so số tip, nên cả hai lỗi lọt qua. Test mới thất bại trên bản build cũ ở đúng hai chỗ này. Mutation check cho phần ngày: 28 chỗ sửa thử, cả 28 bị test bắt.

**Dọn dẹp:** hai dataset tổng hợp (`synth-35000`, `synth-100000`) đã xoá khỏi DB và thư mục publish, danh sách dataset chỉ còn dengue. File nguồn vẫn ở `data/tmp/synth/`; mốc M7 cần đo lại thì tạo lại bằng lệnh ghi ở đầu `do-dac/scripts/w5-viewer/xuat_dataset_tong_hop.py`.

---

## Phase 7: `map` (mốc M4)

Đặc tả: `specs/SPEC-map.md`; quyết định: ADR-007. Nguồn đường biên được đồng ý ngày 2026-10-13 (HDX cho bộ 34, geoBoundaries cho bộ 63); không cài thêm gói nào.

- [x] T7.1 Bộ dựng hình học (`npm run build:map`): khớp tên với mã của `admin_unit`, gộp 63 tỉnh thành 6 vùng và 3 miền, rút gọn lớp HDX, chiếu và ghi `src/map/vn-map.json` (138 KB, 25 KB khi nén). Kiểm chứng: 50 test đơn vị; mutation check trên `generate.ts`: 34 chỗ sửa, cả 34 bị bắt (`507af94`)
- [x] T7.2 Xếp mẫu vào địa bàn ở bốn lớp, đếm, độ phủ, cấp mở đầu, bộ lọc theo địa bàn (thuần logic). Kiểm chứng: vitest
- [x] T7.3 Bảng bản đồ SVG: thang màu năm lớp (qua `validate_palette.js --ordinal`), chú giải, dòng tóm tắt, danh sách địa bàn, tooltip, bàn phím; nối vào bộ lọc chung của cây. Kiểm chứng: Playwright
- [x] T7.4 Đo tiêu chí B7 và chụp ảnh. Số liệu ở `do-dac/results/W5-viewer-webapp/viewer_denv1_2000_qua_nginx_co_ban_do.json`, ảnh `06`–`08` trong `anh/`

## Checkpoint F (hết mốc M4)

| Tiêu chí | Ngưỡng | Kết quả | Nguồn |
|---|---|---|---|
| B1 | đủ địa bàn mỗi cấp, mã khớp `admin_unit` | 3 miền, 6 vùng, 63 tỉnh, 34 đơn vị; 106 mã và tên khớp bảng xuất từ DB | `vn-map.test.ts`; test `(criterion B1)` |
| B2 | số mẫu khớp file publish ở mọi cấp | khớp ở cả bốn lớp, từng địa bàn và số "chưa xếp được"; build DENV1: 925 trong 1.489 mẫu Việt Nam theo miền, 209 theo vùng và theo tỉnh | test `(criterion B2)` |
| B3 | bản đồ là bộ lọc dùng chung | bấm một miền: dòng đếm, số tip cây vẽ, chú giải và bản đồ cùng đổi và khớp; lọc theo genotype thì số trên bản đồ đổi theo | test `(criterion B3)` |
| B4 | bộ 34 cộng mẫu của các tỉnh gộp vào | đúng với cả 34 đơn vị | `placement.test.ts`; test `(criterion B4)` |
| B5 | hình học đúng | hình gộp có đúng diện tích các tỉnh thành phần; hình trên lưới lệch nhiều nhất 1,05%; bộ 34 (HDX) so với 63 tỉnh gộp lại (geoBoundaries) lệch dưới 10% ở 33 đơn vị, nhiều nhất 15% | `vn-map.test.ts` |
| B6 | Hoàng Sa, Trường Sa có mặt | thuộc Đà Nẵng và Khánh Hòa ở cả bốn lớp, có nhãn | `vn-map.test.ts`; test `(criterion B6)` |
| B7 | không làm chậm cây | hình học là file riêng, không nằm trong bundle chính (bundle chính tăng 14 KB); khung hình đầu của DENV1 qua nginx 184 ms khi có bản đồ, 179 ms trước đó (các lần chạy lẻ dao động 172–189 ms) | kích thước build; `do_viewer.mjs` |
| B8 | dùng được bằng bàn phím | địa bàn có mẫu focus được, đọc tên và số mẫu, Enter và phím cách bật tắt bộ lọc; địa bàn trống không nằm trong thứ tự Tab | test `(criterion B8)` |

**Kiểm chứng lúc đóng checkpoint (2026-10-13):** `npm run test` → 226 passed; `npm run typecheck`, `npm run lint` sạch; `npm run e2e` → 27 passed; `npm run e2e:web` → 32 passed (27 test của viewer và bản đồ qua nginx, 5 test của cấu hình nginx). Mutation check cho phần bản đồ chạy trong trình duyệt: 43 chỗ sửa thử, cả 43 bị bắt (22 bởi test đơn vị, 21 qua nginx).

**Lỗi tìm ra trong lúc làm, đã sửa:**
- **Bản đồ chọn cấp mở đầu trước khi các cột địa bàn về.** Khi máy bận, nó mở ở cấp tỉnh rồi tự nhảy sang cấp miền, làm mất lựa chọn người xem vừa bấm. Lỗi chỉ lộ ra khi chạy cả bộ test song song. Nay bản đồ chờ đủ cột rồi mới vẽ; chạy cả bộ đầu-cuối 4 lần song song, 104 lượt đều qua.
- **Cột địa bàn tải lỗi thì bản đồ lặng lẽ hiện số 0.** Nay nó báo lỗi và cho thử lại.

**Điều cần biết:**
- Dữ liệu công khai mỏng ở cấp tỉnh: build DENV1 chỉ có 2 tỉnh có mẫu (Khánh Hòa 205, Hà Nội 4). Bản đồ vì thế mở ở cấp miền. Mẫu nộp qua mốc M5 sẽ mang mã tỉnh.
- Hai lớp tỉnh đến từ hai nguồn, nên đường bờ biển lệch nhau chút ít khi đổi giữa bộ 63 và bộ 34.
- Mã tỉnh của Tổng cục Thống kê cho 34 đơn vị đã có trong file hình học, chưa đưa vào bảng `admin_unit`.
- Chưa làm: phóng to và kéo bản đồ; nhớ việc ẩn bản đồ giữa các lần mở trang; vùng của 34 đơn vị mới theo cách chia sau sáp nhập.

---

## Phase 8: `accounts` (mốc M5, phần đăng nhập)

Đặc tả: `specs/SPEC-accounts.md`; quyết định: ADR-008. Không thêm dependency nào.

- [x] T8.1 Băm mật khẩu bằng scrypt của thư viện chuẩn, chuỗi băm tự mô tả, chuẩn hoá NFKC, trần số lần băm cùng lúc. Kiểm chứng: `tests/test_passwords.py`
- [x] T8.2 Bảng `app_user`, `user_session`, `audit_log` (migration 0008); đăng nhập, đăng xuất, `GET /api/auth/me`, khoá sau 5 lần sai, header chống CSRF cho mọi request ghi, `CurrentUser` và `AdminUser`. Kiểm chứng: `tests/test_auth_api.py`
- [x] T8.3 Lệnh `python -m app.cli create-user`. Kiểm chứng: test trong `tests/test_auth_api.py` và script bằng chứng trên stack thật
- [x] T8.4 Trang `#/login` và khối tài khoản ở thanh đầu trang. Kiểm chứng: `frontend/e2e/auth.spec.ts` trên stack thật, tài khoản tạm tạo bằng lệnh quản trị và xoá sau khi chạy
- [x] T8.5 Review độc lập hai bước, sửa theo review, reviewer đọc lại bản sửa (chấp nhận). Chi tiết ở mục "Review độc lập" của đặc tả

| Tiêu chí | Kết quả | Nguồn |
|---|---|---|
| A1 đăng nhập, `me`, đăng xuất có hiệu lực ngay ở server | đạt | `test_auth_api.py`; cookie cũ gửi lại sau khi đăng xuất nhận 401 qua nginx |
| A2 endpoint admin: 401 khi chưa đăng nhập, 403 với người nộp | đạt | `test_auth_api.py` |
| A3 chuỗi băm và token không rời server, không vào nhật ký | đạt | `test_auth_api.py`; quét hai bảng trên stack thật: 0 bí mật |
| A4 khoá sau 5 lần sai, giữ qua các request | đạt, kể cả khi các lần sai được gửi cùng lúc | test dùng session thật của ứng dụng; test 8 lần sai song song |
| A5 request ghi thiếu header bị từ chối | đạt | 4 phương thức x 5 đường dẫn |
| A6 review độc lập trước khi gộp | đạt | 18 điều kiểm: 16 đạt, 2 không đạt và đã sửa; bản sửa được chấp nhận |
| A7 trang đăng nhập | đạt | 8 test đầu-cuối |

**Kiểm chứng lúc đóng (2026-10-13):** backend `pytest` trong image api → 372 passed, 13 skipped; trong image worker → 385 passed. Mutation check của module: 81 chỗ sửa thử, cả 81 bị test bắt. Frontend: `npm run test` → 235 passed; `npm run e2e` → 35 passed; `npm run e2e:web` → 40 passed.

**Số đo qua nginx, tham số băm thật:** bốn kiểu đăng nhập thất bại trả lời giống nhau từng byte, trung vị 285 đến 292 ms; 30 lần đăng nhập sai gửi cùng lúc vào một tài khoản thì 12 lần được kiểm tra, 18 lần nhận 503, `/api/health` trong lúc đó chậm nhất 61 ms và database thấy nhiều nhất 4 kết nối bận.

**Lỗi do review tìm ra, đã sửa:** các lần đăng nhập vào cùng một email xếp hàng sau khoá của dòng tài khoản trước khi trần số lần băm được xét, nên một loạt 20 request làm cả API treo. Test của tôi trước đó chỉ thử trần ở tầng hàm băm, không thử qua endpoint với cùng một tài khoản.

**Chưa làm (đã ghi trong ADR-008):** giới hạn tần suất theo IP ở nginx, HTTPS, đổi và đặt lại mật khẩu, giao diện admin để khoá tài khoản, dọn định kỳ phiên hết hạn và nhật ký.

## Quyết định cho các câu hỏi mở (mặc định đề xuất trong đặc tả, áp dụng tới khi bạn đổi)
- Build frontend bằng Node 24 portable trên máy; chạy được offline hoàn toàn (không font, không CDN ngoài).
- Định dạng cột giữ JSON. Số đo ở T6.11 không cho lý do để đổi: `tree.json` 3,48 MB ở 35 nghìn tip và 10,05 MB ở 100 nghìn tip, khung hình đầu 313 ms và 464 ms (máy cục bộ, chưa nén). Xét lại nếu phép đo trên mạng chậm cho kết quả khác.
- Tài khoản do admin tạo (CLI); có bảng `audit_log` đơn giản.
- Mẫu nộp hiện ngay với nhãn "tạm" sau khi qua kiểm tra chất lượng; admin có nút ẩn. Mỗi lần nộp một chuỗi.
