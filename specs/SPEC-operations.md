# Spec: module `operations` (mốc M6)

Trạng thái: **đã triển khai và đã qua review độc lập** (2026-10-13). Các câu hỏi mở dùng phương án đề xuất ở cuối file.

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
- Admin bấm "Dựng ngay" thì bỏ qua điều kiện 2 và 3, giữ điều kiện 1. Lệnh quản trị `enqueue build_dataset` đi qua cùng hàm đó, nên cũng không xếp được job thứ hai.

### Theo dõi job

- Danh sách job cho admin: loại, trạng thái, tham số, thời điểm, thời gian chạy, worker, dòng đầu của lỗi; lọc theo trạng thái và loại. Chi tiết một job: các bước với thời gian và đuôi log của từng bước.
- Đếm job theo trạng thái và tuổi của job chờ lâu nhất, để thấy hàng đợi có bị nghẽn không.
- **Chạy lại một job hỏng**: xếp một job mới cùng loại, cùng tham số, cùng độ ưu tiên; job cũ giữ nguyên để tra cứu. Với `ingest_sample`, lần nộp trỏ sang job mới, nên mẫu rời tình trạng "Việc kiểm tra bị lỗi". Chỉ job hỏng mới chạy lại được, và một job chỉ được chạy lại một lần (job mới ghi `retry_of`).

### Sửa địa danh

- Danh sách các cách viết chưa khớp của mẫu trong nước (từ `division_raw`, `location_raw`), kèm số mẫu của từng cách viết.
- Admin gán một cách viết cho một đơn vị (tỉnh của bộ 63 hoặc 34, vùng, miền). Hệ thống thêm một dòng `place_alias` (nguồn `admin`), rồi **phân giải lại địa danh của mọi bản ghi GenBank trong nước** bằng đúng bộ phân giải dùng lúc nhập. Mẫu do phòng xét nghiệm nộp không bị đụng tới: tỉnh của nó do người nộp chọn.
- Build hiện hành nào có mẫu vừa đổi thì được **publish lại** (job `publish_build`): cột tỉnh và vùng của bản publish được viết lại từ database, cây không bị dựng lại. Đây là chỗ bản publish theo hash (ADR-006) trả công: sửa một địa danh tốn vài giây thay vì một lần build.
- Admin xoá được alias do admin thêm (alias của seed thì không); việc phân giải lại và publish lại chạy như trên.
- Khoá của alias là `place_key(cách viết)`: chữ và số của bất kỳ bảng chữ nào, đã bỏ dấu. Khoá rỗng, khoá dài hơn 80 ký tự (`PLACE_TOO_LONG`), khoá đã có, đơn vị không tồn tại đều bị từ chối.

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

## Kết quả (2026-10-13)

| # | Kết quả | Nguồn |
|---|---|---|
| O1 | đạt: mỗi nhánh một test (chưa từng build, không có lịch, chưa tới hạn, đầu vào không đổi, đổi mẫu, đổi ngày, đổi chuỗi, build hỏng, job hỏng trước khi chọn mẫu) | `tests/test_schedule.py` |
| O2 | đạt: bốn luồng bị giữ lại giữa việc xét rồi mới cho đi tiếp, đúng một job được xếp | `tests/test_schedule.py` |
| O3 | đạt: mẫu nộp qua form thành tip chính thức nhờ đúng một build do lịch xếp, chạy bằng vòng lặp của worker với công cụ thật; lần xét ngay sau đó và một lần xét "một tuần sau" không xếp thêm gì | `tests/test_ingest.py` |
| O4 | đạt: 401 và 403 cho cả 10 đường của module; mọi đường ghi cần header chống CSRF | `tests/test_operations_api.py` |
| O5 | đạt: lần nộp trỏ sang job mới, job cũ còn nguyên; bốn lời gọi chạy lại cùng lúc cho đúng một job mới | `tests/test_operations_api.py` |
| O6 | đạt. Trên database thật và cây DENV1 thật (1.964 tip): lời gọi API 83 ms, bản publish mới tới người xem sau 0,64 giây (trung vị 3 lần), không job dựng cây nào được xếp, `tree.json` giữ nguyên hash; lần dựng cây gần nhất mất 682 giây | `tests/test_operations_api.py`; `do-dac/results/W8-van-hanh/sua_dia_danh_tron_luong.json` |
| O7 | đạt | `tests/test_operations_api.py` |
| O8 | đạt; thời hạn giữ nhật ký bằng 0 bị từ chối ở cấu hình và ở hàm dọn | `tests/test_housekeeping.py`, `tests/test_worker.py` |
| O9 | đạt: bốn test đầu-cuối, chạy cả qua nginx | `frontend/e2e/admin.spec.ts` |

Kiểm chứng trên commit cuối: backend `pytest` trong image api 599 passed, 17 skipped; trong image worker (công cụ thật) 616 passed; frontend 277 test đơn vị, `typecheck` và `lint` sạch; `npm run e2e` 46 passed; `npm run e2e:web` 52 passed. Mutation check: 123 chỗ sửa thử (112 của module, 11 của các bản sửa sau review), tất cả bị test bắt. Ở lượt đầy đủ đầu tiên có sáu chỗ sống sót và một test treo; lượt thứ hai còn hai chỗ; test được bổ sung cho từng chỗ.

## Review độc lập (2026-10-13)

Reviewer không viết code, làm ba bước: liệt kê 30 điều sẽ kiểm khi chỉ có đặc tả; đọc code và bằng chứng; đọc lại bản sửa. Kết quả bước hai: 25 đạt, 3 không đạt, 2 không xác định được; không tìm ra đường nào vượt quyền admin, bỏ qua CSRF, làm mất hay nhân đôi việc khi chạy lại job, hay làm lịch dựng mãi hoặc không bao giờ dựng. Bước ba: chấp nhận bản sửa. Reviewer đọc code và số đo, không tự chạy test.

| Phát hiện | Xử lý |
|---|---|
| Cách viết không phải chữ Latinh (chữ Kirin, chữ Hán) gán được nhưng không bỏ được: đường xoá chỉ nhận khoá a-z và 0-9 | Đã sửa: đường xoá nhận mọi khoá mà `place_key` sinh ra được |
| Cách viết có khoá rất dài làm API trả 500 | Đã sửa: khoá dài hơn 80 ký tự bị từ chối với `PLACE_TOO_LONG`. Giới hạn là 80 chứ không phải 100 vì khoá còn được ghi vào `audit_log.subject` sau tiền tố `place:` |
| Lệnh quản trị `enqueue build_dataset` xếp job dựng cây mà không khoá dòng dataset | Đã sửa: lệnh đi qua `request_build`. Bảo đảm nằm ở code, không có ràng buộc ở database; reviewer chấp nhận và ghi nhận một index duy nhất sẽ là lưới an toàn thêm |
| Chi phí của việc xét lịch (lặp mỗi phút khi tới hạn mà đầu vào không đổi) chưa có số đo | Đã đo: 19 tới 64 ms mỗi dataset; ghi vào ADR-010 |
| Số 71 ms đo trên một bản ghi nằm ngoài cây, nên không có job publish nào được xếp trong phép đo đó | Đã đo lại trọn đường trên một mẫu nằm trong cây (dòng O6 ở trên) |
| Thêm một alias phân giải lại mọi bản ghi GenBank trong nước, không riêng bản ghi dùng cách viết đó | Giữ nguyên, đúng thiết kế. Hệ quả: nếu bảng đơn vị hay file seed đã đổi từ lúc nhập, các thay đổi đó được áp cùng lúc; số mẫu đổi hiện trên giao diện |
| Dọn định kỳ chỉ chạy khi hàng đợi trống | Giữ nguyên, đúng thiết kế |

## Điều cần biết

- Dữ liệu GenBank hiện có không còn địa danh Việt Nam nào chưa khớp, nên trang sửa địa danh chưa có việc thật để làm; nó dành cho lần nhập kế tiếp. Các phép đo và test đầu-cuối tự tạo cách viết lạ rồi trả lại như cũ.
- Hash đầu vào không thấy thay đổi của công cụ, tham số pipeline hay định nghĩa clade. Sau những thay đổi đó admin bấm "Dựng ngay".
- Lịch chưa được để chạy qua nhiều ngày trên dữ liệu thật: bằng chứng là test với đồng hồ được truyền vào và một lần chạy vòng lặp worker với công cụ thật.
- Bản publish cũ không bị xoá khi có bản mới (1,7 MB mỗi bản ở DENV1).
- Job hỏng không tự chạy lại; chưa huỷ được một job đang chạy.
- Migration 0010 mới được thử lên, xuống rồi lên lại trên database rỗng và chạy một lần trên database phát triển; chưa có test với dữ liệu có sẵn. Mọi cột mới đều cho phép để trống.

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
