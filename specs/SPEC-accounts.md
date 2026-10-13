# Spec: module `accounts` (mốc M5, phần đăng nhập)

Trạng thái: **backend đã triển khai** (2026-10-13), chờ reviewer độc lập; giao diện đăng nhập làm cùng module `submission`. Các câu hỏi mở dùng phương án đề xuất. Lý do của các lựa chọn ở ADR-008.

## Objective

Phân biệt ba loại người dùng để module `submission` và `operations` có chỗ dựa: khách (không đăng nhập) chỉ xem; người nộp được nộp mẫu và xem mẫu của mình; admin được chạy build, xem job, sửa địa danh.

## Phạm vi

Có:
- Bảng `app_user` (email, tên hiển thị, chuỗi băm mật khẩu, vai trò `submitter` hoặc `admin`, cờ khoá, bộ đếm đăng nhập sai), `user_session` và `audit_log`.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `GET /api/admin/users` (chỉ admin): danh sách tài khoản.
- Lệnh `python -m app.cli create-user` để tạo tài khoản.
- Hai dependency kiểm tra quyền dùng chung: `CurrentUser` (đã đăng nhập) và `AdminUser` (là admin).

Không: tự đăng ký, đăng nhập qua bên thứ ba, đặt lại hay đổi mật khẩu, xác thực hai lớp, phân quyền theo nhóm hay theo dataset (mọi dữ liệu đã publish là công khai).

## Thiết kế

- Mật khẩu băm bằng **scrypt** của thư viện chuẩn (N = 2^17, r = 8, p = 1), chuẩn hoá NFKC trước khi băm, dài 10 tới 200 ký tự tính trên dạng đã chuẩn hoá. Chuỗi lưu tự ghi thuật toán và tham số. Nhiều nhất 4 lần băm chạy cùng lúc và 8 lần chờ; vượt trần thì 503 `LOGIN_BUSY`.
- Phiên đăng nhập là một token ngẫu nhiên 256 bit; DB chỉ lưu SHA-256 của token. Token nằm trong cookie `vs_session`: `HttpOnly`, `SameSite=Lax`, `Secure` khi `VS_COOKIE_SECURE` bật. Phiên hết hạn sau 7 ngày không dùng, và muộn nhất 30 ngày sau lúc đăng nhập.
- Mọi request ghi (POST, PUT, PATCH, DELETE) phải có header `X-Requested-With` do frontend tự gắn; thiếu thì 403 `CSRF_HEADER_REQUIRED`.
- Đăng nhập thất bại vì lý do nào cũng trả 401 `INVALID_CREDENTIALS` với cùng một thông báo, tốn cùng một lần băm và để lại một dòng nhật ký.
- Câu trả lời ở `/api/auth/` và `/api/admin/` mang `Cache-Control: no-store`. Lỗi chưa lường trước trả 500 `INTERNAL_ERROR`, không kèm chi tiết.
- Năm lần sai liên tiếp trong 15 phút thì khoá tài khoản 15 phút, kể cả với mật khẩu đúng.
- Lỗi theo dạng chung của API: 401 `NOT_AUTHENTICATED`, 403 `FORBIDDEN`.
- Nhật ký: `login`, `login_failed`, `login_locked`, `login_refused`, `logout`, `user_created`. Không ghi email đã thử.

## Tiêu chí nghiệm thu

| # | Tiêu chí | Kiểm bằng |
|---|---|---|
| A1 | Đăng nhập đúng nhận cookie; `GET /api/auth/me` trả vai trò; đăng xuất làm phiên hết hiệu lực ngay ở server | `test_auth_api.py` |
| A2 | Endpoint dành cho admin trả 401 khi chưa đăng nhập, 403 khi là người nộp | `test_auth_api.py` |
| A3 | Chuỗi băm mật khẩu và token phiên không xuất hiện trong response hay nhật ký nào | `test_auth_api.py` |
| A4 | Sau 5 lần sai, lần thứ 6 bị từ chối kể cả khi mật khẩu đúng, cho tới khi hết thời gian khoá; số lần sai được giữ qua các request | `test_auth_api.py` (có test dùng session thật của ứng dụng) |
| A5 | Request ghi thiếu header `X-Requested-With` bị từ chối | `test_auth_api.py` |
| A6 | Phần này có reviewer độc lập đọc lại trước khi gộp | báo cáo review |

## Quyết định cho các câu hỏi mở

1. **Ai được tạo tài khoản?** Chỉ admin, qua dòng lệnh. Tự đăng ký cần xác minh email, tức cần dịch vụ gửi thư.
2. **Nhật ký hành động:** có bảng `audit_log` ngay từ đầu.
