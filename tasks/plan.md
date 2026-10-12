# Implementation Plan: VietStrain

## Overview

Xây webapp theo từng module trong capability map của `SPEC.md`, mỗi module là một chuỗi lát cắt dọc mỏng: mỗi lát thêm đúng những bảng, hàm và endpoint nó cần, có test viết trước, được kiểm chứng lúc chạy thật rồi mới commit. Danh sách task chi tiết ở `tasks/todo.md`.

## Architecture Decisions

Mỗi quyết định được ghi thành ADR khi module liên quan bắt đầu.

| Quyết định | Lý do ngắn | ADR (viết cùng module) |
|---|---|---|
| PostgreSQL vừa là kho mẫu vừa là hàng đợi job | Nextstrain không có bản ghi theo mẫu; một thành phần ít hơn so với thêm Redis | ADR-001, `platform` |
| Địa danh có mã, hiệu lực theo thời gian và bảng tên thay thế | Nextstrain dùng tên làm khoá: 2% bản ghi Việt Nam ra được tỉnh | ADR-002, `geo` |
| Pipeline chỉ thấy mã nội bộ; gọi công cụ bằng danh sách đối số | Tên có dấu làm hỏng `augur tree`; tham số tự do cho phép chèn lệnh | ADR-003, `job-queue` |
| Các bước pipeline là hàm Python có trạng thái trong DB, không dùng Snakemake | Giao diện cần thấy tiến độ, log, thời gian từng bước | ADR-004, `job-queue` |
| Gióng từng mẫu một lần lúc nạp, build ghép lại | `align` tăng nhanh hơn tuyến tính (318 s ở 5000 chuỗi) | ADR-005, `build` |
| Hai đường cập nhật: đặt mẫu tạm ngay, dựng lại theo lịch | Dựng lại 2020 s so với đặt mẫu 4,4 s ở 5000 chuỗi | ADR-006, `submission` |
| Cây vẽ trên Canvas, dữ liệu là mảng phẳng ngoài React | Auspice đứng từ 5k tip; prototype B nhanh hơn 10 lần khi tải | ADR-007, `viewer` |

## Task List

### Phase 1: `platform`
- [x] T1.1 Walking skeleton: Compose, `/api/health`, pytest và ruff chạy được

### Checkpoint A
- [x] Test qua, lint qua, `curl` health trả 200

### Phase 2: `geo`
- [x] T2.1 `place_key()`: chuẩn hoá tên địa danh
- [x] T2.2 Bảng `admin_unit`, `place_alias` và khung migration
- [x] T2.3 Seed 63 tỉnh, 34 đơn vị, vùng và tên thay thế
- [x] T2.4 `resolve_place()`: gán đơn vị theo tên và ngày lấy mẫu

### Checkpoint B
- [x] Tiêu chí 4c: ≥ 95% trong 331 cách viết ra đúng tỉnh (320/331 chỉ nhờ chuẩn hoá)

### Phase 3: `samples`
- [x] T3.1 Bảng `sample`, `sample_sequence`; phân tích ngày không đầy đủ
- [x] T3.2 Lệnh nhập GenBank, chạy lại không nhân đôi
- [x] T3.3 Nhập 59.551 bản ghi dengue thật; báo cáo địa danh Việt Nam
- [x] T3.4 API tra cứu mẫu theo tỉnh, khoảng ngày, có phân trang

### Checkpoint C (hết mốc M1)
- [x] Tiêu chí 4 và 4b đạt trên dữ liệu thật (782 và 2.306 trên 4.305 bản ghi)
- [x] Câu "mẫu của tỉnh X trong khoảng ngày" trả lời được bằng một request

### Phase 4: `job-queue`
- [x] T4.1 Bảng `job`, `job_step`; `enqueue()` và `claim()` không lấy trùng
- [x] T4.2 `run_tool()`: gọi công cụ ngoài không qua shell, có timeout
- [x] T4.3 Worker và image worker; job chạy thử có ghi bước và lỗi

### Phase 5: `build`
- [x] T5.1 Cấu hình pathogen dengue; gióng và QC từng mẫu bằng Nextclade
- [ ] T5.2 Gióng và QC toàn bộ genome đã nhập
- [ ] T5.3 `dataset_def`, `build`; chọn mẫu cho một dataset
- [ ] T5.4 Các bước dựng cây với mã nội bộ, chạy được trên bộ nhỏ
- [ ] T5.5 Định dạng cột, publish theo hash, `GET /api/datasets`
- [ ] T5.6 Build thật cho DENV1; so thời gian từng bước với P1

### Checkpoint D (hết mốc M2): dừng lại để bạn xem
- [ ] Tiêu chí 2 và 5 đạt
- [ ] Trình bày kết quả, đặc tả module `viewer`, `accounts`, `submission` và các câu hỏi mở
- [ ] Xin phép cài dependency cho frontend

### Phase 6 trở đi
`viewer`, `map`, `accounts`, `submission`, `operations`, `evaluation`: được chia task sau Checkpoint D, khi đặc tả từng module được duyệt.

## Risks and Mitigations

| Rủi ro | Mức | Cách giảm |
|---|---|---|
| Cây do Augur xuất không dùng được làm cây nền cho Nextclade | Cao | Đã chứng minh ở prototype A (`ancestral --root-sequence`); test hồi quy ở T5.4 |
| Gióng 59 nghìn chuỗi mất lâu | Trung bình | Chỉ gióng genome ≥ 10.000 nt; chạy nền, có thể chạy tiếp khi gián đoạn |
| RAM 13 GB không đủ cho build lớn | Trung bình | Trần số mẫu mỗi dataset; P1 đo đỉnh 3,4 GB ở 5000 chuỗi |
| Nguồn đường biên tỉnh không có giấy phép phù hợp | Trung bình | Kiểm tra giấy phép trước khi dùng; phương án lùi là bản đồ điểm theo tâm tỉnh |
| Bảng 63 → 34 sai ở một dòng | Thấp | Đã đối chiếu với toàn văn Nghị quyết 202/2025/QH15 (xem `backend/app/geo/data/NGUON.md`); nên mở văn bản gốc kiểm lại một lần trước khi trích |

## Open Questions

Xem mục Open Questions trong `SPEC.md`.
