# Spec: module `operations` (mốc M6)

Trạng thái: **đang làm** (2026-10-13). Các câu hỏi mở dùng phương án đề xuất ở cuối file.

## Objective

Hệ thống tự chạy được mà không cần người gõ lệnh: cây được dựng lại theo lịch khi có mẫu mới, admin thấy job nào đang chạy và job nào hỏng, và admin sửa được địa danh chưa khớp ngay trên giao diện.

Ba việc này hiện đều phải làm bằng dòng lệnh trong container (`python -m app.cli enqueue ...`, `job <id>`, sửa file seed rồi `seed-geo`). Với Nextstrain, cả ba cũng nằm ngoài ứng dụng: lịch là GitHub Actions, tiến độ là log của Snakemake, địa danh là file TSV trong repo.

## Thiết kế

### Lịch build (`app/jobs/schedule.py`)

- `dataset_def.build_interval_hours`: số giờ giữa hai lần build tự động; `NULL` là không tự build.
- Một build tự động được xếp hàng khi đủ ba điều kiện:
  1. dataset chưa có job dựng cây nào đang chờ hoặc đang chạy;
  2. lần thử gần nhất (kể cả lần hỏng, và kể cả job hỏng trước khi kịp chọn mẫu) bắt đầu cách đây ít nhất `build_interval_hours`, hoặc dataset chưa từng được build;
  3. **tập đầu vào sẽ được chọn khác với tập đầu vào của cây đang được phát.** Mỗi build ghi `inputs_hash`: hash của danh sách mẫu nó chọn, vai trò, ngày lấy mẫu và hash chuỗi của từng mẫu. Việc chọn mẫu là tất định (`selection.py`), nên so hash là đủ để biết dựng lại có cho cây khác hay không. Phép so là với build hiện hành, không phải với lần thử gần nhất: một lần build hỏng không thành build hiện hành, nên nó được thử lại ở chu kỳ sau. Địa danh và tên hiển thị không nằm trong hash, vì chúng không đổi cây.
- Không có mẫu nào đủ điều kiện thì không xếp hàng.
- Worker chung gọi việc xét lịch mỗi phút. Worker chỉ nhận `ingest_sample` thì không xét lịch. Việc xét khoá dòng của dataset, nên hai worker cùng xét không xếp hai job.
- Admin bấm "Dựng ngay" thì bỏ qua điều kiện 2 và 3, giữ điều kiện 1.

### Theo dõi job

- Danh sách job cho admin: loại, trạng thái, tham số, thời điểm, thời gian chạy, worker, dòng đầu của lỗi; lọc theo trạng thái và loại. Chi tiết một job: các bước với thời gian và đuôi log của từng bước.
- Đếm job theo trạng thái và tuổi của job chờ lâu nhất, để thấy hàng đợi có bị nghẽn không.
- **Chạy lại một job hỏng**: xếp một job mới cùng loại, cùng tham số, cùng độ ưu tiên; job cũ giữ nguyên để tra cứu. Với `ingest_sample`, lần nộp trỏ sang job mới, nên mẫu rời tình trạng "Việc kiểm tra bị lỗi". Chỉ job hỏng mới chạy lại được, và một job chỉ được chạy lại một lần (job mới ghi `retry_of`).

### Sửa địa danh

- Danh sách các cách viết chưa khớp của mẫu trong nước (từ `division_raw`, `location_raw`), kèm số mẫu của từng cách viết.
- Admin gán một cách viết cho một đơn vị (tỉnh của bộ 63 hoặc 34, vùng, miền). Hệ thống thêm một dòng `place_alias` (nguồn `admin`), rồi **phân giải lại địa danh của mọi bản ghi GenBank trong nước** bằng đúng bộ phân giải dùng lúc nhập. Mẫu do phòng xét nghiệm nộp không bị đụng tới: tỉnh của nó do người nộp chọn.
- Build hiện hành nào có mẫu vừa đổi thì được **publish lại** (job `publish_build`): cột tỉnh và vùng của bản publish được viết lại từ database, cây không bị dựng lại. Đây là chỗ bản publish theo hash (ADR-006) trả công: sửa một địa danh tốn vài giây thay vì một lần build.
- Admin xoá được alias do admin thêm (alias của seed thì không); việc phân giải lại và publish lại chạy như trên.
- Khoá của alias là `place_key(cách viết)`. Khoá rỗng, khoá đã có, đơn vị không tồn tại đều bị từ chối.

### Dọn định kỳ

- Worker chung, lúc rảnh, mỗi giờ: xoá phiên đăng nhập đã hết hạn và dòng `audit_log` cũ hơn `VS_AUDIT_RETENTION_DAYS` (mặc định 365, ít nhất 1: giá trị 0 sẽ xoá sạch nhật ký nên bị từ chối ở cả cấu hình lẫn hàm dọn).

### API (mọi endpoint dưới đây chỉ dành cho admin: 401 khi chưa đăng nhập, 403 với người nộp)

| Endpoint | Việc |
|---|---|
| `GET /api/admin/jobs?status=&kind=&limit=&offset=` | danh sách job, mới nhất trước, kèm số job theo trạng thái |
| `GET /api/admin/jobs/{id}` | một job và các bước của nó |
| `POST /api/admin/jobs/{id}/retry` | chạy lại một job hỏng; 409 nếu job chưa hỏng hoặc đã được chạy lại |
| `PATCH /api/admin/datasets/{slug}` | đặt `buildIntervalHours` (số nguyên 1 tới 8760, hoặc `null`; chuỗi, số lẻ và `true` bị từ chối) |
| `POST /api/admin/datasets/{slug}/builds` | dựng ngay; 409 nếu đang có job dựng cây của dataset |
| `GET /api/admin/places/unresolved` | các cách viết chưa khớp, kèm số mẫu |
| `GET /api/admin/places/aliases` | alias do admin thêm |
| `POST /api/admin/places/aliases` | thêm alias, phân giải lại, publish lại; trả số mẫu đổi và các dataset được publish lại |
| `DELETE /api/admin/places/aliases/{key}` | xoá alias do admin thêm |

`GET /api/datasets` có thêm `buildIntervalHours` (công khai: người xem biết cây được cập nhật bao lâu một lần).

### Giao diện

- `#/admin/jobs`: bảng job, tự tải lại khi còn job chờ hoặc đang chạy; mở một job để xem các bước và log; nút "Chạy lại" ở job hỏng.
- `#/admin/datasets`: mỗi dataset một dòng: build hiện hành, lịch, nút "Dựng ngay".
- Mã của ba trang được tải riêng (15 KB), người xem cây không phải tải.
- `#/admin/places`: cách viết chưa khớp, chọn đơn vị, nút "Gán"; danh sách alias đã thêm, nút "Xoá".
- Ba trang chỉ có trong thanh điều hướng của admin. Người không phải admin mở địa chỉ đó thấy lời báo không có quyền; quyền thật được kiểm ở API.

## Tiêu chí nghiệm thu

| # | Tiêu chí | Ngưỡng |
|---|---|---|
| O1 | Build tới hạn và có mẫu mới thì được xếp hàng; tập mẫu không đổi thì không; chưa tới hạn thì không | Có test cho từng nhánh |
| O2 | Hai worker xét lịch cùng lúc | Đúng một job được xếp |
| O3 | Mẫu nộp thành tip chính thức qua build theo lịch, không lệnh tay nào | Test với công cụ thật; chạy lại việc xét lịch ngay sau đó không xếp thêm job |
| O4 | Admin xem được job, các bước và lỗi; người khác không | 401 và 403 cho mọi endpoint admin của module |
| O5 | Chạy lại job kiểm tra đã hỏng đưa mẫu tới kết luận | Test: mẫu từ "bị lỗi" sang "đang kiểm tra", job cũ còn nguyên |
| O6 | Thêm alias: mẫu chưa khớp được gán đơn vị, bản publish mới có cột tỉnh đã đổi, `tree.json` giữ nguyên từng byte | Có test; đo thời gian trên build DENV1 thật so với một lần build |
| O7 | Mẫu do phòng xét nghiệm nộp không bị việc phân giải lại đổi tỉnh | Có test |
| O8 | Phiên hết hạn và nhật ký quá hạn bị xoá định kỳ; phiên còn hạn và nhật ký còn hạn thì không | Có test |
| O9 | Ba trang admin dùng được trên stack thật | Test đầu-cuối: dựng ngay, xem job, chạy lại, gán một địa danh |

## Ngoài phạm vi

- Lịch kiểu cron (giờ cố định trong ngày). Khoảng cách tính bằng giờ là đủ cho việc "mỗi đêm" hoặc "mỗi tuần".
- Huỷ một job đang chạy.
- Sửa `max_samples` và các quy tắc chọn mẫu của dataset trên giao diện.
- Tạo và khoá tài khoản trên giao diện (vẫn bằng lệnh quản trị).
- Sửa đơn vị hành chính (thêm tỉnh, đổi hiệu lực): vẫn qua file seed.

## Quyết định cho các câu hỏi mở

1. Lịch do worker chung tự xét, không thêm service hay công cụ lập lịch nào.
2. Dataset mặc định không có lịch; admin bật cho từng dataset.
3. Nhật ký hành động giữ 365 ngày.
