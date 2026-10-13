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
- **Mật khẩu dài từ 10 tới 200 ký tự, tính trên dạng đã chuẩn hoá**, để một mật khẩu được nhận hay không không phụ thuộc bộ gõ. Chuỗi gửi lên dài quá 800 ký tự bị từ chối trước khi chuẩn hoá hay băm.
- **Nhiều nhất 4 lần đăng nhập được xử lý cùng lúc và 8 lần chờ.** Mỗi lần băm giữ khoảng 128 MB, và đăng nhập là endpoint không cần quyền gì; không có trần thì 40 request cùng lúc đòi khoảng 5 GB. Một lần đăng nhập giữ chỗ của nó từ trước câu truy vấn đầu tiên tới sau khi commit, không chỉ trong lúc băm: các lần đăng nhập vào cùng một email xếp hàng sau khoá của dòng tài khoản, và chỗ xếp hàng đó cũng phải nằm trong trần. Request vượt trần bị từ chối ngay với 503 `LOGIN_BUSY`, không tính là một lần sai. Lần đang chờ tới lượt chưa mở transaction, nên đăng nhập không bao giờ giữ quá 4 kết nối database. Đo qua nginx với tham số thật, 30 lần đăng nhập sai gửi cùng lúc vào một tài khoản: 12 lần được kiểm tra (401), 18 lần nhận 503 (lần chậm nhất sau 378 ms); trong lúc đó `/api/health` trả lời chậm nhất 61 ms, và PostgreSQL thấy nhiều nhất 4 kết nối bận, 3 trong số đó chờ khoá.
- **Tham số đọc từ một chuỗi băm đã lưu bị chặn ở 256 MB bộ nhớ** (gấp đôi mức hiện tại, để còn chỗ nâng tham số): một dòng bị sửa trong DB không bắt được server cấp phát hàng gigabyte.
- **Phiên đăng nhập là một token ngẫu nhiên 256 bit, lưu ở server.** DB chỉ giữ SHA-256 của token; token thật nằm trong cookie `HttpOnly`, `SameSite=Lax`, thêm `Secure` khi cấu hình `VS_COOKIE_SECURE` bật (sau HTTPS). Phiên hết hạn sau 7 ngày không dùng, và muộn nhất 30 ngày sau lúc đăng nhập. Đăng xuất xoá dòng phiên, nên token hết hiệu lực ngay.
- **Mọi request ghi phải mang header `X-Requested-With`.** Trang khác không gắn được header tự đặt khi gửi kèm cookie, vì API không cho phép origin nào khác (không bật CORS). Đây là lớp thứ hai bên cạnh `SameSite=Lax`.
- **Mọi lần đăng nhập thất bại cho cùng một câu trả lời** (`INVALID_CREDENTIALS`), dù là email lạ, sai mật khẩu hay tài khoản đang bị khoá, và đều tốn đúng một lần băm và một dòng nhật ký, để câu trả lời và thời gian trả lời không cho biết email nào có tài khoản. Email lạ được so với một chuỗi băm giả; chuỗi đó được tính lúc API khởi động, để lần đăng nhập đầu tiên không phải tự tính nó và chậm gấp đôi. Đo qua nginx với tham số thật, 20 lần mỗi kiểu: trung vị 285, 291, 287 và 292 ms cho email lạ, sai mật khẩu, đang tự khoá và admin khoá; đăng nhập đúng 292 ms.
- **Câu trả lời ở `/api/auth/` và `/api/admin/` mang `Cache-Control: no-store`**, kể cả câu trả lời 500 cho lỗi chưa lường trước: lỗi của mọi route được bắt và trả lời ở cùng lớp gắn header này, chi tiết chỉ nằm trong log của server.
- **Năm lần sai mật khẩu liên tiếp trong 15 phút thì khoá tài khoản 15 phút**, kể cả với mật khẩu đúng. Bộ đếm nằm trên dòng của tài khoản và được khoá dòng khi đọc, nên các lần thử song song không vượt được nó.
- **Tài khoản do admin tạo bằng dòng lệnh** (`python -m app.cli create-user`); mật khẩu được hỏi hoặc đọc từ stdin, không nhận qua tham số. Không có tự đăng ký.
- **Bảng `audit_log`** ghi đăng nhập, đăng nhập sai, khoá, lần thử khi đang khoá, đăng xuất và tạo tài khoản. Nó không bao giờ ghi mật khẩu hay token, và không ghi email đã thử: người dùng hay gõ nhầm mật khẩu vào ô email.

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
- Mỗi lần đăng nhập tốn khoảng 0,3 giây CPU và 128 MB bộ nhớ ở server; bộ nhớ dành cho việc băm không vượt quá khoảng 512 MB, và server kiểm được khoảng 13 lần đăng nhập mỗi giây. Chưa có giới hạn theo địa chỉ IP ở nginx: một loạt request đăng nhập vẫn chiếm được cả 12 chỗ và làm người khác nhận 503. Phần còn lại của API không bị kéo theo: 12 lần đó giữ nhiều nhất 12 trong 40 luồng và 4 trong 15 kết nối database.
- API khởi động chậm thêm khoảng 0,3 giây (một lần băm cho chuỗi băm giả).
- Mỗi request có đăng nhập thêm một truy vấn tìm phiên. Lần dùng phiên được ghi lại nhiều nhất một phút một lần.
- Chưa có: đặt lại mật khẩu, đổi mật khẩu, xác thực hai lớp, trang quản lý tài khoản. Quên mật khẩu thì admin tạo lại tài khoản.
- Chưa có HTTPS (ADR-006); trên máy phát triển cookie đi qua HTTP ở `127.0.0.1`. Đưa lên server phải bật HTTPS và `VS_COOKIE_SECURE`.
- Phiên hết hạn chỉ bị xoá khỏi DB khi chính tài khoản đó đăng nhập lại, và `audit_log` chưa có thời hạn lưu; việc dọn định kỳ thuộc mốc M6.
- `create-user --password-stdin` đọc UTF-8 và dừng nếu gặp byte không phải UTF-8. Nó không phát hiện được trường hợp shell đã đổi chữ có dấu thành `?` trước khi gửi (Windows PowerShell 5.1 làm vậy khi nối ống): mật khẩu có dấu nên được gõ trực tiếp, không dùng `--password-stdin`.
