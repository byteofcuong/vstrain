# Spec: module `accounts` (mốc M5, phần đăng nhập)

Trạng thái: **bản nháp chờ duyệt**.

## Objective

Phân biệt ba loại người dùng để module `submission` và `operations` có chỗ dựa: khách (không đăng nhập) chỉ xem; người nộp được nộp mẫu và xem mẫu của mình; admin được chạy build, xem job, sửa địa danh.

## Phạm vi

Có:
- Bảng `app_user` (email, tên hiển thị, hash mật khẩu, vai trò `submitter` hoặc `admin`, trạng thái khoá) và `user_session`.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Lệnh `python -m app.cli create-user` để tạo tài khoản đầu tiên.
- Một dependency kiểm tra vai trò dùng chung cho mọi endpoint ghi.

Không: đăng nhập qua bên thứ ba, đặt lại mật khẩu qua email, xác thực hai lớp, phân quyền theo nhóm hay theo dataset (mọi dữ liệu hiện là công khai).

## Thiết kế

- Mật khẩu hash bằng **Argon2id** (gói `argon2-cffi`, cài trong image của dự án).
- Phiên đăng nhập là một token ngẫu nhiên 256 bit; DB chỉ lưu SHA-256 của token. Token nằm trong cookie `HttpOnly`, `SameSite=Lax`, `Secure` khi chạy sau HTTPS. Phiên hết hạn sau 7 ngày không dùng.
- Mọi request ghi (POST, PUT, PATCH, DELETE) phải có header `X-Requested-With` do frontend tự gắn, để chặn form từ trang khác gửi kèm cookie.
- Đăng nhập sai trả cùng một thông báo cho "sai email" và "sai mật khẩu"; giới hạn 5 lần sai liên tiếp mỗi tài khoản trong 15 phút.
- Lỗi theo dạng chung của API: 401 `NOT_AUTHENTICATED`, 403 `FORBIDDEN`.

## Tiêu chí nghiệm thu

- Đăng nhập đúng nhận cookie; `GET /api/auth/me` trả vai trò; đăng xuất làm cookie hết hiệu lực ngay ở server.
- Endpoint dành cho admin trả 401 khi chưa đăng nhập, 403 khi là người nộp.
- Hash mật khẩu và token phiên không xuất hiện trong response, log hay thông báo lỗi nào.
- Sau 5 lần sai, lần thứ 6 bị từ chối kể cả khi mật khẩu đúng, cho tới khi hết thời gian khoá.
- Phần này có reviewer độc lập đọc lại trước khi gộp.

## Câu hỏi mở

1. **Ai được tạo tài khoản?** Đề xuất: chỉ admin tạo (qua CLI, sau này qua trang admin). Tự đăng ký cần xác minh email, tức cần dịch vụ gửi thư.
2. Có cần nhật ký hành động (ai nộp gì, ai chạy build nào) ngay từ đầu không? Đề xuất: có một bảng `audit_log` đơn giản.
