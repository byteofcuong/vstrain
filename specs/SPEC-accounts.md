# Spec: module `accounts` (mốc M5, phần đăng nhập)

Trạng thái: **đã triển khai và đã qua review độc lập** (2026-10-13). Các câu hỏi mở dùng phương án đề xuất. Lý do của các lựa chọn ở ADR-008.

## Objective

Phân biệt ba loại người dùng để module `submission` và `operations` có chỗ dựa: khách (không đăng nhập) chỉ xem; người nộp được nộp mẫu và xem mẫu của mình; admin được chạy build, xem job, sửa địa danh.

## Phạm vi

Có:
- Bảng `app_user` (email, tên hiển thị, chuỗi băm mật khẩu, vai trò `submitter` hoặc `admin`, cờ khoá, bộ đếm đăng nhập sai), `user_session` và `audit_log`.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `GET /api/admin/users` (chỉ admin): danh sách tài khoản.
- Lệnh `python -m app.cli create-user` để tạo tài khoản.
- Hai dependency kiểm tra quyền dùng chung: `CurrentUser` (đã đăng nhập) và `AdminUser` (là admin).
- Giao diện: trang `#/login`; thanh đầu trang có đường dẫn "Đăng nhập", hoặc tên người đang đăng nhập và nút "Đăng xuất".

Không: tự đăng ký, đăng nhập qua bên thứ ba, đặt lại hay đổi mật khẩu, xác thực hai lớp, phân quyền theo nhóm hay theo dataset (mọi dữ liệu đã publish là công khai).

## Thiết kế

- Mật khẩu băm bằng **scrypt** của thư viện chuẩn (N = 2^17, r = 8, p = 1), chuẩn hoá NFKC trước khi băm, dài 10 tới 200 ký tự tính trên dạng đã chuẩn hoá. Chuỗi lưu tự ghi thuật toán và tham số. Nhiều nhất 4 lần đăng nhập được xử lý cùng lúc và 8 lần chờ, kể cả khi chúng cùng nhắm một tài khoản; vượt trần thì 503 `LOGIN_BUSY`.
- Phiên đăng nhập là một token ngẫu nhiên 256 bit; DB chỉ lưu SHA-256 của token. Token nằm trong cookie `vs_session`: `HttpOnly`, `SameSite=Lax`, `Secure` khi `VS_COOKIE_SECURE` bật. Phiên hết hạn sau 7 ngày không dùng, và muộn nhất 30 ngày sau lúc đăng nhập.
- Mọi request ghi (POST, PUT, PATCH, DELETE) phải có header `X-Requested-With` do frontend tự gắn; thiếu thì 403 `CSRF_HEADER_REQUIRED`.
- Đăng nhập thất bại vì lý do nào cũng trả 401 `INVALID_CREDENTIALS` với cùng một thông báo, tốn cùng một lần băm và để lại một dòng nhật ký.
- Câu trả lời ở `/api/auth/` và `/api/admin/` mang `Cache-Control: no-store`. Lỗi chưa lường trước trả 500 `INTERNAL_ERROR`, không kèm chi tiết.
- Năm lần sai liên tiếp trong 15 phút thì khoá tài khoản 15 phút, kể cả với mật khẩu đúng.
- Lỗi theo dạng chung của API (`SPEC.md`: `code`, `message`, và `details` chỉ ở lỗi 422): 401 `NOT_AUTHENTICATED`, 403 `FORBIDDEN`.
- Nhật ký: `login`, `login_failed`, `login_locked`, `login_refused`, `logout`, `user_created`. Không ghi email đã thử.

## Tiêu chí nghiệm thu

| # | Tiêu chí | Kiểm bằng |
|---|---|---|
| A1 | Đăng nhập đúng nhận cookie; `GET /api/auth/me` trả vai trò; đăng xuất làm phiên hết hiệu lực ngay ở server | `test_auth_api.py` |
| A2 | Endpoint dành cho admin trả 401 khi chưa đăng nhập, 403 khi là người nộp | `test_auth_api.py` |
| A3 | Chuỗi băm mật khẩu và token phiên không xuất hiện trong response hay nhật ký nào | `test_auth_api.py` |
| A4 | Sau 5 lần sai, lần thứ 6 bị từ chối kể cả khi mật khẩu đúng, cho tới khi hết thời gian khoá; số lần sai được giữ qua các request | `test_auth_api.py` (có test dùng session thật của ứng dụng) |
| A5 | Request ghi thiếu header `X-Requested-With` bị từ chối | `test_auth_api.py` |
| A6 | Phần này có reviewer độc lập đọc lại trước khi gộp | mục "Review độc lập" bên dưới |
| A7 | Trang đăng nhập: đăng nhập, đăng xuất, một lời báo cho mọi kiểu thất bại, dùng được chỉ bằng bàn phím, có tiếng Anh | `frontend/e2e/auth.spec.ts`, chạy trên stack thật |

## Tạo tài khoản

Từ thư mục gốc của repo, khi stack đang chạy:

```
docker compose -f deploy/docker-compose.yml exec api python -m app.cli create-user --email ten@donvi.vn --name "Tên hiển thị" --role submitter
```

Lệnh hỏi mật khẩu hai lần và không hiện chữ đang gõ. `--role admin` cho tài khoản quản trị. `--password-stdin` dành cho script gửi mật khẩu bằng UTF-8; với Windows PowerShell 5.1, mật khẩu có dấu phải gõ trực tiếp (xem ADR-008).

## Review độc lập (2026-10-13)

Một reviewer không viết mã này làm hai bước: viết danh sách 18 điều cần kiểm từ yêu cầu, rồi mới đọc diff và bằng chứng. Kết quả: 16 điều đạt, 2 điều không đạt. Mỗi phát hiện được đối chiếu lại với mã trước khi sửa.

| Phát hiện | Xử lý |
|---|---|
| Khoá dòng tài khoản được lấy trước khi xét trần số lần băm, nên 20 request cùng nhắm một email không lần nào nhận 503 mà cùng chờ trong PostgreSQL, giữ hết kết nối và làm cả API treo | Sửa: một lần đăng nhập giữ chỗ từ trước câu truy vấn đầu tiên tới sau khi commit. Có test dựng đúng kịch bản (18 lần đăng nhập cùng một tài khoản: 6 lần nhận 503 ngay, không quá 4 kết nối bị giữ) và test các lần sai song song đều được đếm |
| Lần đăng nhập đầu tiên với email lạ sau khi khởi động tốn hai lần băm | Sửa: chuỗi băm giả được tính lúc khởi động |
| Câu trả lời 500 ở `/api/auth/` không có `Cache-Control: no-store` | Sửa: lỗi của mọi route được trả lời ở lớp gắn header |
| `create-user --password-stdin` sập với traceback khi stdin không phải UTF-8 | Sửa: dừng với lời báo rõ; ghi chú cho PowerShell 5.1 |
| Lệnh xoá cookie thiếu `HttpOnly`, `SameSite`, `Secure` | Sửa |
| Trần cho tham số của chuỗi băm đã lưu cho phép tới 2 GB | Sửa: trần 256 MB |
| Lỗi không phải 422 không có key `details` | Không đổi: `SPEC.md` đã ghi `details` chỉ có ở lỗi 422 |
| Phiên hết hạn chỉ bị xoá khi tài khoản đó đăng nhập lại; `audit_log` không có thời hạn lưu | Để mốc M6 (dọn định kỳ) |
| `--role` có giá trị mặc định `submitter` | Không đổi: mặc định là vai trò thấp nhất |

Reviewer không chạy được lệnh nào (chỉ đọc mã và log), và chưa đọc test đầu-cuối của frontend.

## Quyết định cho các câu hỏi mở

1. **Ai được tạo tài khoản?** Chỉ admin, qua dòng lệnh. Tự đăng ký cần xác minh email, tức cần dịch vụ gửi thư.
2. **Nhật ký hành động:** có bảng `audit_log` ngay từ đầu.
