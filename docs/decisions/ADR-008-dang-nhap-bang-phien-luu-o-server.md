# ADR-008: đăng nhập bằng phiên lưu ở server; mật khẩu băm bằng scrypt của thư viện chuẩn

## Status
Accepted

## Date
2026-10-13

## Context
Mốc M5 cần phân biệt ba loại người dùng: khách chỉ xem, người nộp được nộp mẫu, admin được chạy build và sửa địa danh. Auspice không có phần này; nextstrain.org dùng AWS Cognito (`repos/core/nextstrain.org/docs/infrastructure.md`), một dịch vụ ngoài mà bản triển khai trong mạng nội bộ không dùng được.

Ràng buộc của đồ án: chạy được offline trên một máy, không phụ thuộc dịch vụ ngoài (không gửi được thư), ít dependency. Bản triển khai có một origin duy nhất sau nginx (ADR-006), nên cookie phiên là same-origin.

Bản nháp đặc tả ghi băm mật khẩu bằng Argon2id qua gói `argon2-cffi`. Gói này chưa có trong image; thư viện chuẩn của Python có sẵn scrypt.

## Decision
- **Mật khẩu băm bằng scrypt** (`hashlib.scrypt`), tham số N = 2^17, r = 8, p = 1: khoảng 128 MB bộ nhớ và 0,3 giây cho một lần băm trên máy phát triển, là mức tối thiểu OWASP khuyến nghị cho scrypt. Chuỗi lưu trong DB tự ghi thuật toán và tham số, nên nâng tham số hay đổi thuật toán sau này không làm hỏng mật khẩu đã lưu.
- **Mật khẩu được chuẩn hoá Unicode (NFKC) trước khi băm.** Bộ gõ tiếng Việt cho ra chữ dựng sẵn hoặc chữ cái cộng dấu rời tuỳ cấu hình; người dùng thấy cùng một mật khẩu thì hệ thống phải coi là một.
- **Mật khẩu dài từ 10 tới 200 ký tự.** Cận trên chặn việc gửi chuỗi rất dài để bắt server băm.
- **Phiên đăng nhập là một token ngẫu nhiên 256 bit, lưu ở server.** DB chỉ giữ SHA-256 của token; token thật nằm trong cookie `HttpOnly`, `SameSite=Lax`, thêm `Secure` khi cấu hình `VS_COOKIE_SECURE` bật (sau HTTPS). Phiên hết hạn sau 7 ngày không dùng, và muộn nhất 30 ngày sau lúc đăng nhập. Đăng xuất xoá dòng phiên, nên token hết hiệu lực ngay.
- **Mọi request ghi phải mang header `X-Requested-With`.** Trang khác không gắn được header tự đặt khi gửi kèm cookie, vì API không cho phép origin nào khác (không bật CORS). Đây là lớp thứ hai bên cạnh `SameSite=Lax`.
- **Mọi lần đăng nhập thất bại cho cùng một câu trả lời** (`INVALID_CREDENTIALS`), dù là email lạ, sai mật khẩu hay tài khoản đang bị khoá, và đều tốn đúng một lần băm, để câu trả lời và thời gian trả lời không cho biết email nào có tài khoản.
- **Năm lần sai mật khẩu liên tiếp trong 15 phút thì khoá tài khoản 15 phút**, kể cả với mật khẩu đúng. Bộ đếm nằm trên dòng của tài khoản và được khoá dòng khi đọc, nên các lần thử song song không vượt được nó.
- **Tài khoản do admin tạo bằng dòng lệnh** (`python -m app.cli create-user`); mật khẩu được hỏi hoặc đọc từ stdin, không nhận qua tham số. Không có tự đăng ký.
- **Bảng `audit_log`** ghi đăng nhập, đăng nhập sai, khoá, đăng xuất và tạo tài khoản; không bao giờ ghi mật khẩu hay token.

## Alternatives Considered

### Argon2id qua `argon2-cffi` (như bản nháp)
- Ưu: là lựa chọn đầu tiên trong khuyến nghị của OWASP; chống tấn công bằng phần cứng chuyên dụng tốt hơn scrypt ở cùng chi phí.
- Nhược: thêm một gói có phần mã C phải cài vào cả hai image.
- Chưa chọn: scrypt đứng thứ hai trong cùng khuyến nghị và có sẵn. Chuỗi băm tự mô tả nên chuyển sang Argon2id sau này chỉ cần băm lại ở lần đăng nhập kế tiếp của mỗi người.

### JWT không lưu ở server
- Ưu: không cần bảng phiên, không cần truy vấn DB ở mỗi request.
- Nhược: không thu hồi được trước hạn (đăng xuất, khoá tài khoản) nếu không dựng thêm danh sách thu hồi, tức lại là một bảng ở server; token nằm ở JavaScript thì lộ khi có XSS.
- Loại: hệ thống chỉ có một server và một DB, một truy vấn theo khoá duy nhất mỗi request là rẻ.

### Token CSRF riêng cho từng phiên
- Ưu: không dựa vào hành vi của trình duyệt với header tự đặt.
- Nhược: frontend phải lấy và gửi token ở mọi form.
- Chưa cần: `SameSite=Lax` cùng header tự đặt là đủ khi API không bật CORS. Phải xét lại nếu sau này mở API cho origin khác.

### Giới hạn số lần thử theo địa chỉ IP
- Ưu: kẻ tấn công không khoá được tài khoản của người khác.
- Nhược: sau nginx mọi request đến từ cùng một địa chỉ nếu không cấu hình header chuyển tiếp đúng; kẻ tấn công đổi địa chỉ được.
- Chưa làm. Cái giá của cách đang dùng: ai biết email của một tài khoản thì khoá được nó 15 phút mỗi lần bằng năm lần thử sai.

## Consequences
- Không thêm dependency nào cho phần đăng nhập.
- Mỗi lần đăng nhập tốn khoảng 0,3 giây CPU và 128 MB bộ nhớ ở server. Với vài chục người dùng thì không đáng kể; nhiều người đăng nhập cùng lúc thì cần giới hạn số lần băm chạy song song.
- Mỗi request có đăng nhập thêm một truy vấn tìm phiên. Lần dùng phiên được ghi lại nhiều nhất một phút một lần.
- Chưa có: đặt lại mật khẩu, đổi mật khẩu, xác thực hai lớp, trang quản lý tài khoản. Quên mật khẩu thì admin tạo lại tài khoản.
- Chưa có HTTPS (ADR-006); trên máy phát triển cookie đi qua HTTP ở `127.0.0.1`. Đưa lên server phải bật HTTPS và `VS_COOKIE_SECURE`.
- Chưa có test cho việc hai lần đăng nhập sai chạy đúng cùng lúc; việc khoá dòng dựa vào `SELECT ... FOR UPDATE` của PostgreSQL.
