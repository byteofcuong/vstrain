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

**Kiểm chứng:** 14 test mới thất bại trên mã cũ; `DC run --rm worker pytest` → 267 passed; `DC run --rm api pytest` → 255 passed, 12 skipped (commit `f94412d`)

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
- [x] D2: commit ba bản đặc tả nháp trong `specs/`; gộp `feature/build` vào `main` (`98efe17`)
- [ ] D3 (việc của bạn, không chặn việc đang làm): đọc `specs/SPEC-accounts.md`, `SPEC-submission.md` và mục "Quyết định cho các câu hỏi mở" ở cuối file; đổi chỗ nào thì báo. Dependency frontend đã được đồng ý

**Nhóm dọn nợ kỹ thuật backend** (từ review, chưa sửa; mỗi mục cỡ S)
- [x] N1: worker rảnh thì dọn thư mục làm việc của job đã kết thúc quá 7 ngày (`a613d1f`)
- [x] N2: publish xoá thư mục `.tmp-*` còn sót của lần chạy hỏng, trừ thư mục mới hơn một giờ (`81fd3ee`)
- [x] N3: IQ-TREE nhận seed cố định từ cấu hình lineage (`967fd3f`). Kiểm chứng: test đọc dòng `Seed:` trong log của IQ-TREE. Chưa kiểm chứng rằng hai lần build cho đúng cùng một cây: IQ-TREE chọn số luồng tự động (`-T AUTO`), và số luồng khác nhau có thể cho kết quả khác nhau dù cùng seed

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

**Kết quả của T6.11 (2026-10-13, commit `e9f6145`; Chromium headless, 5 lần mỗi dataset):**

| Tiêu chí | Ngưỡng | Đo được | Đạt |
|---|---|---|---|
| 3: khung hình đầu ở 35 nghìn tip | ≤ 1 s | 313 ms (trung vị; 463 / 313 / 306 / 327 / 312) | có |
| 3b: lọc theo ngày, đổi cột màu ở 35 nghìn tip | main thread bận ≤ 100 ms, không task trên 50 ms | bận nhiều nhất 67,7 ms; task dài nhất 44,1 ms | có |
| V1: dataset 100 nghìn tip mở được | có khung hình, không lỗi | khung hình đầu 464 ms; 0 lỗi; 14 thao tác chạy xong ở cả 5 lần | có |

- Các số trên đo bản build do `vite preview` phục vụ (không nén). Qua service `web` (nginx, nén gzip lúc phát), khung hình đầu là 418 ms ở 35 nghìn tip và 804 ms ở 100 nghìn tip; tiêu chí 3 và 3b vẫn đạt.
- Ngoài phạm vi tiêu chí 3b: lần đầu đổi sang bố cục toả tròn trong một phiên có một task 51–77 ms ở 35 nghìn tip.
- Bộ vẽ được tối ưu trong lúc đo (`1123011`, `b23cf3e`, `e9f6145`): chỉ vẽ nét thêm pixel mới, tip nhỏ vẽ thành ô 2 × 2 pixel, bố cục toả tròn bỏ nhánh ngoài khung nhìn, mỗi lượt màu chỉ duyệt node của màu đó. Khi kéo cây liên tục ở 35 nghìn tip, main thread cần 12–25 ms cho một khung hình (trước: 21–37 ms); ở 100 nghìn tip 22–38 ms (trước: 44–94 ms).
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

**Kiểm chứng lúc đóng checkpoint (2026-10-13, commit `f14b8e6`):** `npm run test` → 148 passed; `npm run typecheck`, `npm run lint` sạch; `npm run e2e` → 12 passed; `npm run e2e:web` → 17 passed (12 test của viewer qua nginx, 5 test của cấu hình nginx).

**Hai lỗi tìm ra khi đối chiếu tiêu chí V2 với file publish, đã sửa (`f14b8e6`):**
- **Ngày trên cây lệch một ngày.** Trong `tree.json`, tip nằm ở giữa ngày lấy mẫu (quy ước của TreeTime) và `augur export` làm tròn 3 chữ số thập phân; viewer lại làm tròn tới nửa đêm gần nhất. Trên build DENV1, 606 trong 1.964 tip hiện một ngày nằm ngoài ngày lấy mẫu đã khai (352 trong 773 mẫu có ngày đầy đủ bị muộn một ngày; mẫu chỉ khai năm 1971 hiện 1972-01-01). Sau khi sửa: 0.
- **Bộ lọc "Đến ngày" làm rơi tip ở cuối ngày.** Cận trên đặt ở 99% của ngày được chọn, nên tip có thời điểm rơi vào mấy phút cuối ngày bị loại (3 tip của build DENV1). Nay bộ lọc giữ hai ngày dạng chữ và đổi sang một khoảng thời điểm khớp với cách viewer gọi tên ngày.
- Test cũ của V2 chỉ so số tip, nên cả hai lỗi lọt qua. Test mới thất bại trên bản build cũ ở đúng hai chỗ này. Mutation check cho phần ngày: 28 chỗ sửa thử, cả 28 bị test bắt.

**Dọn dẹp:** hai dataset tổng hợp (`synth-35000`, `synth-100000`) đã xoá khỏi DB và thư mục publish, danh sách dataset chỉ còn dengue. File nguồn vẫn ở `data/tmp/synth/`; mốc M7 cần đo lại thì tạo lại bằng lệnh ghi ở đầu `do-dac/scripts/w5-viewer/xuat_dataset_tong_hop.py`.

---

## Phase 7: `map` (mốc M4)

Đặc tả: `specs/SPEC-map.md`; quyết định: ADR-007. Nguồn đường biên được đồng ý ngày 2026-10-13 (HDX cho bộ 34, geoBoundaries cho bộ 63); không cài thêm gói nào.

- [x] T7.1 Bộ dựng hình học (`npm run build:map`): khớp tên với mã của `admin_unit`, gộp 63 tỉnh thành 6 vùng và 3 miền, rút gọn lớp HDX, chiếu và ghi `src/map/vn-map.json` (138 KB, 25 KB khi nén). Kiểm chứng: 50 test đơn vị; mutation check trên `generate.ts`: 34 chỗ sửa, cả 34 bị bắt (`bf10c14`)
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

## Phase 9: `submission` (mốc M5, phần nộp mẫu)

Đặc tả: `specs/SPEC-submission.md`; quyết định: ADR-009. Không thêm dependency nào.

- [x] T9.1 Kiểm tra một lần nộp: FASTA, tên, ngày, vật chủ; mọi lỗi báo trong một lượt. Kiểm chứng: `tests/test_submission_validate.py`
- [x] T9.2 `sample.status`, bảng `submission` và `sample_placement` (migration 0009); API nộp, xem mẫu của mình, tip tạm của dataset, admin ẩn và hiện; trần số mẫu đang chờ. Kiểm chứng: `tests/test_submissions_api.py`, `tests/test_submissions_commit.py`
- [x] T9.3 Job `ingest_sample` (tự tìm serotype, nhận hoặc từ chối, gắn tạm bằng Nextclade) và `place_pending` sau mỗi build; worker riêng cho mẫu nộp. Kiểm chứng: `tests/test_ingest.py` với công cụ thật, `tests/test_placement_read.py`
- [x] T9.4 Trang nộp mẫu, trang "Mẫu của tôi", tip tạm trên cây (hình thoi rỗng, tooltip, bảng chi tiết, công tắc). Kiểm chứng: `frontend/e2e/submission.spec.ts` trên stack thật
- [x] T9.5 Đo tiêu chí 1 và thử việc tự tìm serotype trên stack thật. Số liệu ở `do-dac/results/W7-nop-mau/`
- [x] T9.6 Review độc lập hai bước (23 điều kiểm: 18 đạt, 2 không đạt, 3 không xác định được), sửa theo review, reviewer đọc lại bản sửa (chấp nhận). Chi tiết ở mục "Review độc lập" của đặc tả

## Checkpoint G (hết mốc M5)

| Tiêu chí | Ngưỡng | Kết quả | Nguồn |
|---|---|---|---|
| 1 | nộp tới tip tạm công khai ≤ 30 giây, dataset ≤ 5.000 tip | đạt ở cây 1.964 tip: trung vị 1,07 giây, chậm nhất 1,18 (20 lần, qua nginx); khi worker chung bị dừng, trung vị 1,13 giây (5 lần). **Chưa đo ở 5.000 tip** | `do-dac/results/W7-nop-mau/` |
| 1b | hàng xóm gần nhất trùng cây dựng lại ≥ 85% | **chưa đo trên ứng dụng**, để mốc M7 | |
| 5 | tên "Hà_Nội/01/2024" đi trọn luồng | đạt, cả với tên có `; touch pwned`: không file nào của job chứa tên, tên có trong bản publish của build kế tiếp | `test_ingest.py`; `submission.spec.ts` |
| S1 | file sai bị từ chối 422, không tạo job | đạt; request trên 4 MB nhận 413 thay vì 422 (có chủ ý) | `test_submissions_api.py` |
| S2 | genome khác serotype được gán đúng hoặc bị từ chối | đạt: 20 trong 20 genome GenBank gán đúng, 3 trong 3 chuỗi ngẫu nhiên bị từ chối | `test_ingest.py`; `serotype.json` |
| S3 | người nộp chỉ thấy và sửa được mẫu của mình | **đạt phần "thấy"; phần "sửa" chưa làm** | `test_submissions_api.py` |

**Kiểm chứng lúc đóng checkpoint (2026-10-13):** backend `pytest` trong image api → 525 passed, 17 skipped; trong image worker (công cụ thật) → 542 passed. Frontend: `npm run test` → 268 passed; `npm run typecheck`, `npm run lint` sạch; `npm run e2e` → 42 passed; `npm run e2e:web` → 48 passed. Mutation check: kiểm tra lúc nộp 47 chỗ sửa thử, luồng nộp và gắn 103, các chỗ sửa sau review 25; tất cả bị test bắt (4 chỗ ở lượt đầu sống sót, đã bổ sung test).

**Lỗi tìm ra trong lúc làm, đã sửa:**
- **Mẫu đạt kiểm tra nhưng chưa gắn xong bị báo là "chưa có cây"**, làm trang "Mẫu của tôi" ngừng tự tải lại. Test đầu-cuối tìm ra.
- **Tám lần nộp gửi cùng lúc đều lọt qua trần số mẫu đang chờ.** Nay dòng tài khoản được khoá trong lúc đếm và ghi.
- **nginx trả 502 cho mọi request API sau khi container `api` khởi động lại** (nó giữ địa chỉ cũ). Nay tên `api` được phân giải lúc chạy.
- **nginx từ chối file FASTA trên 1 MB bằng một trang HTML**, trong khi API nhận tới 2 MB. Nay giới hạn của nginx rộng hơn của API.
- **Bảng bên cuộn cả trang** (có từ mốc M3, lộ ra trên ảnh chụp màn hình thấp).
- **Do review tìm ra:** mẫu có job hỏng chiếm chỗ trong trần mãi mãi; một mẫu không gắn được chặn mọi mẫu đứng sau nó; lùi migration làm lộ mẫu chưa công khai.

**Điều cần biết:**
- Sửa mẫu đã nộp chưa có. Muốn sửa thì admin ẩn mẫu và người nộp nộp lại.
- Job kiểm tra đã hỏng không tự chạy lại; từ mốc M6 admin chạy lại bằng nút bấm ở trang job.
- Mẫu bị ẩn sau khi đã vào một build vẫn nằm trong file của build đó cho tới lần build kế tiếp.
- Dữ liệu công khai không có genome Việt Nam nào đứng ngoài build, nên phép đo dùng genome GenBank của nước khác.
- 261 trong 2.633 genome Việt Nam đã gióng dài hơn 10.000 nucleotide nhưng có dưới 10.000 vị trí đọc được: chúng qua kiểm tra lúc nộp rồi bị từ chối ở bước gióng, với lý do nói rõ.

## Phase 10: `operations` (mốc M6)

Đặc tả: `specs/SPEC-operations.md`; quyết định: ADR-010. Không thêm dependency nào.

- [x] T10.1 Lịch dựng cây: `build_interval_hours`, `inputs_hash`, `retry_of` (migration 0010); worker chung xét lịch mỗi phút và dọn phiên, nhật ký mỗi giờ. Kiểm chứng: `tests/test_schedule.py`, `tests/test_worker.py`, `tests/test_housekeeping.py`
- [x] T10.2 Mẫu nộp thành tip chính thức qua build do lịch xếp, với công cụ thật. Kiểm chứng: `tests/test_ingest.py` trong image worker
- [x] T10.3 API quản trị: danh sách và chi tiết job, chạy lại job hỏng, đặt lịch, dựng ngay, địa danh chưa khớp, thêm và bỏ tên thay thế (phân giải lại, publish lại không dựng cây). Kiểm chứng: `tests/test_operations_api.py`
- [x] T10.4 Ba trang `#/admin/jobs`, `#/admin/datasets`, `#/admin/places`, tải riêng (15 KB). Kiểm chứng: `frontend/e2e/admin.spec.ts` trên stack thật
- [x] T10.5 Đo O6 và chi phí xét lịch trên database thật. Số liệu ở `do-dac/results/W8-van-hanh/`
- [x] T10.6 Mutation check (123 chỗ sửa thử) và review độc lập ba bước (30 điều kiểm: 25 đạt, 3 không đạt, 2 không xác định được); sửa theo review, reviewer chấp nhận bản sửa. Chi tiết ở mục "Review độc lập" của đặc tả

## Checkpoint H (hết mốc M6)

| Tiêu chí | Ngưỡng | Kết quả | Nguồn |
|---|---|---|---|
| O1 | build được xếp khi tới hạn và có mẫu mới; không xếp khi tập mẫu không đổi hoặc chưa tới hạn | đạt, mỗi nhánh một test | `test_schedule.py` |
| O2 | hai worker xét lịch cùng lúc xếp đúng một job | đạt (bốn luồng bị giữ chồng lên nhau) | `test_schedule.py` |
| O3 | mẫu nộp thành tip chính thức qua build theo lịch, không lệnh tay | đạt với công cụ thật; lần xét kế tiếp không xếp thêm | `test_ingest.py` |
| O4 | chỉ admin xem được job | đạt: 401 và 403 cho cả 10 đường | `test_operations_api.py` |
| O5 | chạy lại job kiểm tra đã hỏng đưa mẫu tới kết luận | đạt | `test_operations_api.py` |
| O6 | thêm alias: mẫu được gán đơn vị, cột tỉnh của bản publish đổi, `tree.json` giữ nguyên | đạt; trên cây DENV1 thật: 0,64 giây từ lời gọi API tới bản publish mới, so với 682 giây của một lần dựng cây | `sua_dia_danh_tron_luong.json` |
| O7 | mẫu do phòng xét nghiệm nộp không bị đổi tỉnh | đạt | `test_operations_api.py` |
| O8 | phiên hết hạn và nhật ký quá hạn bị xoá định kỳ | đạt | `test_housekeeping.py` |
| O9 | ba trang admin dùng được trên stack thật | đạt: bốn test đầu-cuối | `admin.spec.ts` |

**Kiểm chứng lúc đóng checkpoint (2026-10-13):** backend `pytest` trong image api → 599 passed, 17 skipped; trong image worker (công cụ thật) → 616 passed. Frontend: `npm run test` → 277 passed; `npm run typecheck`, `npm run lint` sạch; `npm run e2e` → 46 passed; `npm run e2e:web` → 52 passed. Mutation check: 123 chỗ sửa thử, tất cả bị test bắt sau khi bổ sung test (lượt đầu sáu chỗ sống sót và một test treo, lượt hai còn hai chỗ).

**Lỗi tìm ra trong lúc làm, đã sửa:**
- **Thanh đầu trang của người đã đăng nhập làm trang rộng thêm 152 px ở màn hình 390 px** (có từ mốc M5, lộ ra khi admin có thêm một liên kết).
- **Test "hai worker cùng xét lịch" vẫn xanh khi bỏ khoá dòng của dataset**: bốn luồng chạy đủ nhanh để không bao giờ chồng lên nhau. Mutation check tìm ra.
- **Một test của vòng lặp worker lặp vô hạn thay vì hỏng.** Các test đó nay có giới hạn thời gian.
- **Do review tìm ra:** cách viết không phải chữ Latinh gán được nhưng không bỏ được; cách viết rất dài làm API trả 500; lệnh quản trị `enqueue build_dataset` đi vòng qua quy tắc "mỗi dataset một job dựng cây chưa xong".

**Điều cần biết:**
- Dữ liệu thật hiện không có địa danh Việt Nam nào chưa khớp; trang sửa địa danh dành cho lần nhập kế tiếp.
- Hash đầu vào không thấy thay đổi của công cụ, tham số pipeline hay định nghĩa clade; sau đó phải bấm "Dựng ngay".
- Lịch chưa được để chạy qua nhiều ngày trên dữ liệu thật.
- Bản publish cũ không bị xoá; job hỏng không tự chạy lại; chưa huỷ được job đang chạy. *(Sau mốc M7: đã có huỷ và dọn, Phase 15.)*
- Còn mở từ mốc M5: sửa mẫu đã nộp (S3), tiêu chí 1 ở 5.000 tip, tiêu chí 1b. Hai tiêu chí sau thuộc mốc M7.

## Phase 11: `evaluation` (mốc M7)

Đặc tả: `specs/SPEC-evaluation.md`. Không thêm tính năng, không thêm dependency.

- [x] T11.1 Tiêu chí 1 trên cây 4.949 tip và thời gian build ở 5.000 mẫu (dataset tạm, dựng bằng worker của ứng dụng, đã xoá sau khi đo)
- [x] T11.2 Tiêu chí 1b trên ứng dụng: giấu 100 mẫu, dựng lại, gắn tạm từng mẫu bằng hàm của job nộp mẫu; kèm trần của chỉ số
- [x] T11.3 Chạy lại harness viewer ở 35 nghìn tip, báo cáo địa danh và các test an toàn trên bản cuối
- [x] T11.4 `docs/KET-QUA.md` (bảng trước và sau, cách đo, giới hạn) và file số liệu ở `docs/so-lieu/`
- [x] T11.5 `README.md`

## Checkpoint I (hết mốc M7)

| Tiêu chí | Ngưỡng | Kết quả | Nguồn (`docs/so-lieu/`) |
|---|---|---|---|
| 1 | nộp tới tip tạm công khai ≤ 30 giây, cây ≤ 5.000 tip | đạt: trung vị 2,40 giây ở cây 4.949 tip (20 lần, 1,85–2,78); 1,07 giây ở cây 1.964 tip | `thoi_gian_nop_5000.json`, `thoi_gian_nop_2000.json` |
| 1b | hàng xóm gần nhất trùng cây dựng lại ≥ 85% | đạt: 95 trong 100 (mẫu Việt Nam 69 trong 74); trần đo được 100 trong 100 | `gan_tam.json` |
| 2 | build N = 2.000 không chậm hơn 771 giây; không có bước gióng; thời gian từng bước được ghi | đạt sát ngưỡng: 755, 770, 770 giây trên cùng tập mẫu. **Không nhanh hơn**: ở 5.000 mẫu 2.026 giây so với 2.020 giây | `build_tap_p1_lan*.json`, `job_build_denv1_5000.json` |
| 3 | 35 nghìn tip: khung hình đầu ≤ 1 giây | đạt: 0,47 giây qua nginx trên bản cuối | `viewer_35000_tip.json` |
| 3b | 35 nghìn tip: lọc hoặc đổi màu, main thread bận ≤ 100 ms | đạt: nhiều nhất 40 ms, task dài nhất 26 ms | `viewer_35000_tip.json` |
| 3c | rê chuột và bấm cho đúng mẫu | đạt: 100 tip ngẫu nhiên | `frontend/e2e/viewer.spec.ts` |
| 4, 4b | gán được tỉnh ≥ 781; tỉnh hoặc vùng 2.306 | đạt: 782 và 2.306 trên 4.305 | `dia_danh.json` |
| 4c | 331 cách viết ra đúng tỉnh ≥ 95% | đạt: 96,7% chỉ nhờ chuẩn hoá | `dia_danh_331_cach_viet.json` |
| 5, 5b | tên có dấu đi trọn luồng; chuỗi tấn công không được thực thi | đạt: 61 test của năm file liên quan qua với công cụ thật | `test_an_toan.txt` |

**Kiểm chứng lúc đóng checkpoint (2026-10-13):** backend `pytest` trong image api → 603 passed, 17 skipped; trong image worker (công cụ thật) → 620 passed; `ruff` sạch. Frontend không đổi từ Checkpoint H (277 passed); `npm run e2e` → 46 passed; `npm run e2e:web` → 52 passed, hai lần liền. Thay đổi mã duy nhất của mốc này là bản sửa lỗi 502 ở dưới (4 test mới, 4 chỗ sửa thử đều bị bắt).

**Lỗi tìm ra lúc đóng mốc, đã sửa:**
- **Request ghi bị API từ chối trước khi đọc thân có lúc thành 502 của nginx.** API trả lời rồi đóng kết nối trong lúc nginx còn đang gửi thân; với thân 4,5 MB, 2 trong 160 request nhận trang 502 thay cho lời từ chối 413 mà giao diện đọc được (102 lần nginx ghi nhận kết nối phía sau bị đứt). Test đầu-cuối của nginx hỏng một lần vì thế. Nay API đọc bỏ thân (tới 8 MB) rồi mới trả lời: 640 request liền đều nhận 413, không lần đứt kết nối nào. Thân khai dài hơn 8 MB thì không đọc.

**Điều tìm ra trong lúc đo:**
- **Dựng cây không nhanh hơn Nextstrain ở cả hai cỡ.** Bỏ bước gióng tiết kiệm 77 và 322 giây, nhưng `refine` chậm hơn 85 và 282 giây trên đầu vào của ứng dụng. Chưa tìm hiểu vì sao.
- **Ở lần build 5.000 mẫu, cộng thời gian các bước thiếu 37 giây so với tổng**, gần hết ở bước `refine`. Có thể hai đồng hồ của máy ảo lệch nhau trong lần chạy dài; chưa kiểm chứng. Ở 2.000 mẫu hai cách tính khớp nhau.
- **Trần của tiêu chí 1b ra 100 trong 100**, cao hơn prototype (94–97%). Chưa tìm hiểu vì sao.
- **Console của trình duyệt ghi một dòng 401 mỗi lần khách mở trang** (câu trả lời của `GET /api/auth/me`). Không phải lỗi JavaScript, nhưng harness đếm nó là một lỗi.

**Điều cần biết:**
- Mọi phép đo dùng DENV1, một máy, một người dùng tại một thời điểm.
- Cây 100 nghìn tip không được đo lại trên bản cuối; số của nó là số ở mốc M3.
- Các lệnh trong README đã được chạy trên stack này, ở mốc này hoặc các mốc trước; chưa thử làm theo README trên một máy khác từ một bản clone mới.
- Mấy file cấu hình dengue chép từ `nextstrain/dengue`, repo không có file giấy phép (`backend/app/pathogens/dengue/NGUON.md`).
- Còn mở: sửa mẫu đã nộp (S3 của mốc M5).

## Phase 12: sửa mẫu đã nộp (sau mốc M7)

Đặc tả: mục "Sửa mẫu đã nộp" của `specs/SPEC-submission.md`. Đóng tiêu chí S3 còn mở từ mốc M5. Không thêm dependency, không đổi schema.

- [x] T12.1 `PATCH /api/submissions/{id}`: người nộp sửa tên, ngày, tỉnh, vật chủ của mẫu đã được nhận; cùng phép kiểm tra và mã lỗi với lúc nộp; nhật ký `sample_edited`. Kiểm chứng: `tests/test_submissions_api.py`
- [x] T12.2 Mẫu đang là tip chính thức thì cây được publish lại, không dựng lại (dùng chung hàm với việc sửa địa danh, nay ở `app/jobs/schedule.py`); sửa ngày làm hash đầu vào đổi. Kiểm chứng: cùng file test
- [x] T12.3 Trang `#/mine/<mã>/edit` và liên kết "Sửa" ở trang "Mẫu của tôi"; bốn trường dùng chung một component với form nộp. Kiểm chứng: `frontend/e2e/submission.spec.ts` trên stack thật

**Kiểm chứng (2026-10-13):** backend `pytest` trong image api → 631 passed, 17 skipped; trong image worker → 648 passed; `ruff` sạch. Frontend: `npm run test` → 282 passed; `typecheck`, `lint` sạch; `npm run e2e` → 48 passed; `npm run e2e:web` → 54 passed. Mutation check: 19 chỗ sửa thử, cả 19 bị bắt.

**Điều cần biết:** chuỗi không sửa được; admin không sửa hộ; hai lần sửa cùng lúc thì lần ghi sau thắng; sửa ngày của một tip chính thức chỉ đổi vị trí trên trục thời gian ở lần dựng cây kế tiếp.

## Phase 13: khách mở trang không còn dòng lỗi 401 (sau mốc M7)

- [x] T13.1 `GET /api/auth/session` trả 200 với `user: null` cho khách; giao diện hỏi endpoint này thay cho `/me`. `/me` không đổi. Kiểm chứng: `tests/test_auth_api.py` (2 test mới), `frontend/src/api.test.ts`
- [x] T13.2 Test đầu-cuối: khách mở một cây không có request nào trả mã từ 400 trở lên, không dòng lỗi nào trong console. Test này hỏng trên bản cũ (`401 /api/auth/me` và một dòng console) và qua trên bản mới. Kiểm chứng: `frontend/e2e/auth.spec.ts`

**Kiểm chứng (2026-10-13):** backend `pytest` trong image api → 633 passed, 17 skipped; trong image worker → 650 passed; `ruff` sạch. Frontend: `npm run test` → 282 passed; `typecheck`, `lint` sạch; `npm run e2e` → 49 passed; `npm run e2e:web` → 55 passed.

## Phase 14: đổi mật khẩu và quản lý tài khoản (sau mốc M7)

Đặc tả: mục "Đổi mật khẩu và quản lý tài khoản" của `specs/SPEC-accounts.md`. Không thêm dependency, không đổi schema.

- [x] T14.1 `POST /api/auth/password`: đổi mật khẩu của chính mình, cần mật khẩu hiện tại; lần sai được đếm chung với đăng nhập sai; đổi xong các phiên khác kết thúc. Kiểm chứng: `tests/test_account_management.py`
- [x] T14.2 `/api/admin/users`: admin xem danh sách, tạo tài khoản, khoá, mở khoá, đặt lại mật khẩu của người khác; không tự khoá mình, không đặt lại mật khẩu của mình qua đường này. Kiểm chứng: cùng file test
- [x] T14.3 Trang `#/account` (tên ở thanh đầu trang dẫn tới) và tab `#/admin/users`. Kiểm chứng: `frontend/e2e/accounts.spec.ts` trên stack thật; ảnh chụp ở 1280 px và 390 px
- [x] T14.4 Reviewer độc lập đọc lại (phần này đụng xác thực); sửa bốn phát hiện, mỗi cái có test. Kiểm chứng: mục "Review độc lập (2026-10-14)" của đặc tả

**Kiểm chứng (2026-10-14):** backend `pytest` trong image api → 697 passed, 17 skipped; trong image worker → 714 passed; `ruff` sạch. Frontend: `npm run test` → 290 passed; `typecheck`, `lint` sạch; `npm run e2e` → 53 passed; `npm run e2e:web` → 59 passed. Mutation check: 36 chỗ sửa thử, cả 36 bị bắt.

**Điều cần biết:** không có "quên mật khẩu" qua email; mật khẩu admin đặt không bị ép đổi; hệ thống không giữ lại admin cuối cùng. Lỗi reviewer tìm ra (gửi nhiều lần đoán cùng lúc thì chỉ bị đếm một) không lộ ra trong 32 mutant ban đầu, vì mutant chỉ sửa mã đang có chứ không nghĩ ra trường hợp còn thiếu.

## Phase 15: huỷ job và dọn bản dựng cũ (sau mốc M7)

Đặc tả: mục "Huỷ job và dọn bản dựng cũ" của `specs/SPEC-operations.md`. Không thêm dependency; migration 0011 nới ràng buộc tình trạng của job.

- [x] T15.1 Trạng thái `cancelled`, `POST /api/admin/jobs/{id}/cancel`; worker dừng công cụ đang chạy (cả nhóm tiến trình) ở lần báo nhịp kế tiếp và không bắt đầu bước mới. Kiểm chứng: `tests/test_run_tool.py`, `test_job_steps.py`, `test_worker.py`, `test_operations_api.py`
- [x] T15.2 Nút huỷ (hỏi lại một lần) ở chi tiết công việc; tình trạng, bộ lọc và dòng đếm "đã huỷ"; job đã huỷ chạy lại được. Kiểm chứng: `frontend/e2e/admin.spec.ts` huỷ một lần dựng cây thật khi IQ-TREE đang chạy
- [x] T15.3 Worker chung dọn bản publish đã bị thay thế và build cũ (`VS_PUBLICATION_RETENTION_DAYS`, `VS_KEEP_BUILDS`). Kiểm chứng: `tests/test_prune.py`; chạy thật trên dữ liệu DENV1
- [x] T15.4 Reviewer độc lập đọc lại; sửa bốn phát hiện về việc dọn, mỗi cái có test. Kiểm chứng: mục review của đặc tả

**Kiểm chứng (2026-10-14):** backend `pytest` trong image api → 752 passed, 17 skipped; trong image worker → 769 passed; `ruff` sạch. Frontend: `npm run test` → 292 passed; `typecheck`, `lint` sạch; `npm run e2e` → 54 passed; `npm run e2e:web` → 60 passed.

**Điều cần biết:** công cụ dừng ở lần báo nhịp kế tiếp (đo được 13,6–15,7 giây sau khi bấm); bước chạy bằng Python chạy hết rồi mới dừng; chỉ chạy một worker chung.

## Phase 16: giới hạn đăng nhập theo địa chỉ IP (sau mốc M7)

Đặc tả: mục "Thiết kế" của `specs/SPEC-accounts.md`. Chỉ đổi cấu hình nginx và một lời báo ở trang đăng nhập.

- [x] T16.1 nginx: 30 lần đăng nhập liền nhau từ một địa chỉ, sau đó một lần mỗi 2 giây; vượt thì 429 `TOO_MANY_LOGINS` cùng dạng lỗi với API. Trang đăng nhập có lời báo riêng. Kiểm chứng: `frontend/e2e/limits.spec.ts` (hỏng trước khi đổi cấu hình: 40 trên 40 request tới API)
- [x] T16.2 Sửa lỗi tìm ra khi chạy bộ test: trang công việc ngừng tự tải lại khi một job kết thúc đúng giữa câu truy vấn danh sách và câu truy vấn phần đếm, nên dòng của nó đứng yên ở "Đang chạy". Nay trang còn hỏi lại khi một dòng đang hiện chưa kết thúc. Kiểm chứng: `src/admin/format.test.ts` (hỏng trước khi sửa)

**Kiểm chứng (2026-10-15):** frontend `npm run test` → 293 passed; `typecheck`, `lint` sạch; `npm run e2e` → 54 passed; `npm run e2e:web` → 61 passed, nginx từ chối đúng 20 request (của test giới hạn), không request nào của các test khác.

## Phase 17: HTTPS tuỳ chọn (sau mốc M7)

Không thêm dependency hay image: chứng chỉ tự ký tạo bằng `openssl` của Git Bash; nginx dùng module SSL và HTTP/2 có sẵn trong image.

- [x] T17.1 Tách phần dùng chung của nginx ra `deploy/nginx/` (cấp `http` và thân `server`); bản HTTP không đổi hành vi. Kiểm chứng: `e2e/deploy.spec.ts` và cả `npm run e2e:web` trước và sau khi tách
- [x] T17.2 `deploy/docker-compose.https.yml`, `deploy/nginx-https.conf.template`, `deploy/make-dev-cert.sh`: cổng 8443 với TLS 1.2 và 1.3, HTTP/2; cổng 8080 chuyển hướng mọi đường dẫn; cookie phiên `Secure`; HSTS `max-age=0` ở máy phát triển. Kiểm chứng: `npm run e2e:https` (3 test, hỏng trước khi có cấu hình: không có gì nghe ở 8443); `openssl s_client` cho thấy TLS 1.3 và ALPN `h2`, TLS 1.1 bị từ chối

**Kiểm chứng (2026-10-15):** `npm run e2e:https` → 3 passed khi stack bật kèm file HTTPS; bật lại bản HTTP thì `npm run e2e:web` → 61 passed, `VS_COOKIE_SECURE` không còn được đặt.

## Phase 18: báo chuỗi giống hệt khi nộp (sau mốc M7)

Đặc tả: mục "Báo chuỗi giống hệt khi nộp" của `specs/SPEC-submission.md`. Không thêm dependency; migration 0012 thêm index cho hash của chuỗi.

- [x] T18.1 `POST /api/submissions` trả 409 `IDENTICAL_SEQUENCE` (kèm `matches`, `matchCount`) khi chuỗi giống hệt một mẫu người nộp được phép biết; `allowIdentical: true` thì nhận. Kiểm chứng: `tests/test_submissions_api.py`, `test_submissions_commit.py`, `test_migrations.py`
- [x] T18.2 Form nộp hiện lời hỏi lại và nút "Vẫn nộp"; sửa form thì lời hỏi biến mất. Kiểm chứng: `src/submit/form.test.ts`, `src/api.test.ts`, `frontend/e2e/submission.spec.ts`
- [x] T18.3 Reviewer độc lập đọc lại; sửa ba phát hiện nhỏ. Kiểm chứng: mục review của đặc tả

**Kiểm chứng (2026-10-15):** backend `pytest` trong image api → 766 passed, 17 skipped; trong image worker → 783 passed; `ruff` sạch. Frontend: `npm run test` → 298 passed; `typecheck`, `lint` sạch; `npm run e2e` → 54 passed; `npm run e2e:web` → 61 passed.

## Phase 19: thử README trên một bản clone sạch (sau mốc M7)

- [x] T19.1 Clone `main` (`463c7c3`) ra thư mục mới, chạy từng bước của README với database mới (`-p vstrain-thu`, volume riêng). Kết quả: cả sáu bước chạy được đúng như viết; gióng 39 giây, dựng cây DENV1 704 giây (README ghi "chừng nửa phút" và "khoảng 11 phút"); cây 1.959 tip, không lỗi console; phần HTTPS cũng chạy được. Hai image build lại không dùng cache (mọi phiên bản đã ghim vẫn cài được). Không có gì trong README phải sửa. Ghi chép: `do-dac/results/W14-thu-readme/`

**Chưa thử được:** một máy thật sự mới. Image nền (`python:3.12-slim`, `nextstrain/base`, `postgres:16`, `nginx`) đã có sẵn trong Docker của máy này, và bước nạp dữ liệu dùng file GenBank đã có thay vì chạy workflow `ingest` của nextstrain/dengue.

## Quyết định cho các câu hỏi mở (mặc định đề xuất trong đặc tả, áp dụng tới khi bạn đổi)
- Build frontend bằng Node 24 portable trên máy; chạy được offline hoàn toàn (không font, không CDN ngoài).
- Định dạng cột giữ JSON. Số đo ở T6.11 không cho lý do để đổi: `tree.json` 3,48 MB ở 35 nghìn tip và 10,05 MB ở 100 nghìn tip, khung hình đầu 313 ms và 464 ms (máy cục bộ, chưa nén). Xét lại nếu phép đo trên mạng chậm cho kết quả khác.
- Tài khoản do admin tạo (CLI); có bảng `audit_log` đơn giản.
- Mẫu nộp hiện ngay với nhãn "tạm" sau khi qua kiểm tra chất lượng; admin có nút ẩn. Mỗi lần nộp một chuỗi.
