# Spec: module `accounts` (mốc M5, phần đăng nhập)

Trạng thái: **đã triển khai và đã qua review độc lập** (2026-10-13). Các câu hỏi mở dùng phương án đề xuất. Lý do của các lựa chọn ở ADR-008.

## Objective

Phân biệt ba loại người dùng để module `submission` và `operations` có chỗ dựa: khách (không đăng nhập) chỉ xem; người nộp được nộp mẫu và xem mẫu của mình; admin được chạy build, xem job, sửa địa danh.

## Phạm vi

Có:
- Bảng `app_user` (email, tên hiển thị, chuỗi băm mật khẩu, vai trò `submitter` hoặc `admin`, cờ khoá, bộ đếm đăng nhập sai), `user_session` và `audit_log`.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `GET /api/auth/session` (bổ sung sau mốc M7): ai đang dùng trang, trả 200 với `user: null` cho khách. Giao diện hỏi endpoint này mỗi lần mở trang; hỏi `/me` thì mỗi người khách nhận một dòng lỗi 401 trong console của trình duyệt. `/me` giữ nguyên: 401 khi chưa đăng nhập.
- `GET /api/admin/users` (chỉ admin): danh sách tài khoản.
- Đổi mật khẩu của chính mình, và việc admin tạo, khoá, mở khoá, đặt lại mật khẩu tài khoản (bổ sung sau mốc M7): mục "Đổi mật khẩu và quản lý tài khoản" bên dưới.
- Lệnh `python -m app.cli create-user` để tạo tài khoản.
- Hai dependency kiểm tra quyền dùng chung: `CurrentUser` (đã đăng nhập) và `AdminUser` (là admin).
- Giao diện: trang `#/login`; thanh đầu trang có đường dẫn "Đăng nhập", hoặc tên người đang đăng nhập và nút "Đăng xuất".

Không: tự đăng ký, đăng nhập qua bên thứ ba, đặt lại mật khẩu qua email, xác thực hai lớp, phân quyền theo nhóm hay theo dataset (mọi dữ liệu đã publish là công khai).

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

## Đổi mật khẩu và quản lý tài khoản (bổ sung sau mốc M7)

Trạng thái: **đã triển khai và đã qua review độc lập** (2026-10-14).

Tới mốc M7, tài khoản chỉ được tạo bằng dòng lệnh trong container, mật khẩu không đổi được, và muốn khoá một tài khoản phải sửa thẳng database. Phần này đưa ba việc đó lên giao diện. Hệ thống không có dịch vụ gửi thư, nên không có "quên mật khẩu" qua email: người quên mật khẩu nhờ admin đặt lại.

### Người dùng tự đổi mật khẩu

- `POST /api/auth/password` với `currentPassword` và `newPassword`; cần đăng nhập. Thành công trả 204.
- Phải nhập đúng mật khẩu hiện tại, kể cả khi đã đăng nhập: người cầm được một phiên (máy để mở, cookie bị lấy) không vì thế mà chiếm được tài khoản.
- Nhập sai mật khẩu hiện tại trả 403 `WRONG_PASSWORD` và **được đếm vào cùng bộ đếm với đăng nhập sai**: năm lần trong 15 phút thì tài khoản bị khoá 15 phút, và trong lúc khoá mọi lần đổi mật khẩu nhận 429 `TOO_MANY_ATTEMPTS`, kể cả với mật khẩu đúng. Không có bộ đếm này thì endpoint thành chỗ dò mật khẩu không giới hạn cho người cầm một phiên.
- Mật khẩu mới theo đúng quy tắc của lúc tạo tài khoản (10 tới 200 ký tự sau chuẩn hoá NFKC): sai thì 422 với mã `WEAK_PASSWORD`; trùng mật khẩu hiện tại thì 422 với mã `SAME_PASSWORD`.
- Đổi xong, **mọi phiên khác của tài khoản bị kết thúc**; phiên đang dùng được giữ. Nhật ký `password_changed`; lần nhập sai ghi `password_change_failed`, lần bị từ chối vì đang khoá ghi `password_change_refused`.
- Việc băm nằm trong cùng trần số lần băm đồng thời với đăng nhập; vượt trần thì 503 `LOGIN_BUSY`.

### Admin quản lý tài khoản

| Endpoint | Việc |
|---|---|
| `GET /api/admin/users` | danh sách tài khoản: mã, email, tên, vai trò, có đang bị khoá không, ngày tạo |
| `POST /api/admin/users` | tạo tài khoản với `email`, `displayName`, `role`, `password`; 409 `EMAIL_TAKEN`; 422 với mã riêng cho từng trường |
| `POST /api/admin/users/{id}/lock` | khoá: tài khoản không đăng nhập được, và mọi phiên của nó kết thúc ngay |
| `POST /api/admin/users/{id}/unlock` | mở khoá; cũng xoá luôn việc khoá tạm vì nhập sai nhiều lần |
| `POST /api/admin/users/{id}/password` | đặt mật khẩu mới cho tài khoản khác; mọi phiên của tài khoản đó kết thúc |

- Mọi endpoint chỉ dành cho admin (401, 403), và mọi endpoint ghi cần header chống CSRF như các endpoint khác.
- Admin **không tự khoá mình** (409 `CANNOT_LOCK_SELF`): nếu không, admin duy nhất có thể tự nhốt mình ngoài hệ thống.
- Admin **không đặt lại mật khẩu của chính mình** qua endpoint quản trị (409 `USE_OWN_PASSWORD_FORM`): đổi mật khẩu của mình phải qua form cần mật khẩu hiện tại, nên một phiên admin bị lấy không đủ để chiếm tài khoản đó.
- Mật khẩu do admin đặt là mật khẩu tạm: admin đưa nó cho người dùng qua một kênh khác, và người dùng tự đổi sau lần đăng nhập đầu. Hệ thống **không ép** việc đổi này.
- Không response và không dòng nhật ký nào chứa mật khẩu hay chuỗi băm. Nhật ký: `user_created` (ghi cả admin đã tạo), `user_locked`, `user_unlocked`, `password_reset`.
- Mã tài khoản không tồn tại trả 404 `USER_NOT_FOUND`.

### Giao diện

- `#/account`: email và vai trò của người đang đăng nhập, và form đổi mật khẩu (mật khẩu hiện tại, mật khẩu mới, nhập lại). Tên người dùng ở thanh đầu trang dẫn tới trang này.
- `#/admin/users`: tab thứ tư của trang quản trị. Bảng tài khoản với nút khoá, mở khoá và đặt lại mật khẩu; form tạo tài khoản.

### Tiêu chí nghiệm thu

| # | Tiêu chí | Ngưỡng |
|---|---|---|
| U1 | Đổi mật khẩu: mật khẩu cũ không còn đăng nhập được, mật khẩu mới thì được; phiên đang dùng còn, các phiên khác hết | Có test |
| U2 | Sai mật khẩu hiện tại bị từ chối và bị đếm; đủ năm lần thì bị khoá, kể cả với mật khẩu đúng | Có test |
| U3 | Mật khẩu mới yếu hoặc trùng mật khẩu cũ bị từ chối, và mật khẩu không đổi | Có test |
| U4 | Mọi endpoint quản lý tài khoản: 401 khi chưa đăng nhập, 403 với người nộp, 403 khi thiếu header chống CSRF | Có test cho từng endpoint |
| U5 | Khoá một tài khoản làm phiên đang mở của nó hết hiệu lực ngay, và nó không đăng nhập lại được; mở khoá thì đăng nhập được | Có test |
| U6 | Admin không tự khoá mình và không đặt lại mật khẩu của mình qua endpoint quản trị | Có test |
| U7 | Đặt lại mật khẩu của người khác: mật khẩu cũ hết dùng được, mọi phiên của người đó kết thúc | Có test |
| U8 | Mật khẩu và chuỗi băm không có trong response hay nhật ký nào của các endpoint mới | Có test |
| U9 | Trên stack thật: admin tạo tài khoản, người mới đăng nhập và đổi mật khẩu, admin khoá rồi mở khoá | Test đầu-cuối |
| U10 | Phần này có reviewer độc lập đọc lại trước khi gộp | mục review |

### Kết quả (2026-10-14)

| # | Kết quả | Kiểm bằng |
|---|---|---|
| U1 | Đạt | `test_account_management.py`: mật khẩu cũ bị từ chối, mật khẩu mới đăng nhập được; phiên thứ hai của cùng tài khoản nhận 401, phiên của tài khoản khác không bị đụng |
| U2 | Đạt | Cùng file: năm lần sai thì lần thứ sáu nhận 429 kể cả với mật khẩu đúng; lần sai ở form đổi và ở trang đăng nhập cộng vào một bộ đếm; test dùng session thật cho thấy lần sai được lưu qua các request, và tám lần đoán gửi cùng một lúc đều được đếm |
| U3 | Đạt | Cùng file: 9 và 201 ký tự, dạng dấu rời của mật khẩu cũ, mật khẩu trùng; sau mỗi lần từ chối mật khẩu cũ vẫn đăng nhập được |
| U4 | Đạt | Cùng file: test chạy trên cả năm endpoint quản trị, mỗi endpoint ba trường hợp (chưa đăng nhập, người nộp, thiếu header); endpoint đổi mật khẩu có test riêng |
| U5 | Đạt | Cùng file: phiên đang mở nhận 401 ngay sau khi bị khoá, đăng nhập lại bị từ chối; mở khoá thì đăng nhập được |
| U6 | Đạt | Cùng file: 409 `CANNOT_LOCK_SELF`, 409 `USE_OWN_PASSWORD_FORM`, và không có gì thay đổi sau hai lời từ chối đó |
| U7 | Đạt | Cùng file: mật khẩu cũ hết dùng được, hai phiên của người đó cùng kết thúc, phiên của admin còn |
| U8 | Đạt | Cùng file: mật khẩu và chuỗi băm được tìm trong thân mọi response và mọi dòng `audit_log` sau khi dùng thật |
| U9 | Đạt | `frontend/e2e/accounts.spec.ts` (4 test nối tiếp trên stack thật, cả qua nginx): admin tạo tài khoản trên giao diện, người mới đăng nhập và đổi mật khẩu, admin khoá, mở khoá, đặt lại mật khẩu; phiên ở trình duyệt khác kết thúc đúng lúc |
| U10 | Đạt | Mục "Review độc lập (2026-10-14)" ngay dưới |

Lệnh và kết quả (Git Bash): `pytest` trong image api → 697 passed, 17 skipped; trong image worker → 714 passed; `ruff` sạch. Frontend: `npm run test` → 290 passed; `typecheck`, `lint` sạch; `npm run e2e` → 53 passed; `npm run e2e:web` → 59 passed. Mutation check trên mã backend mới: 36 chỗ sửa thử, cả 36 bị bắt.

Về cách làm: với phần backend, test và mã được viết liền nhau nên chưa có lần nào thấy test hỏng trước khi có mã; độ nhạy của test dựa vào mutation check. Riêng các test thêm sau review thì đều đã thấy hỏng trước khi sửa.

### Review độc lập (2026-10-14)

Một reviewer không viết mã này làm hai bước: viết danh sách 30 điều cần kiểm từ yêu cầu, rồi mới đọc diff và bằng chứng. Kết quả: 27 điều đạt, 1 điều không đạt, 2 điều chưa kết luận được. Mỗi phát hiện được đối chiếu lại với mã trước khi sửa.

| Phát hiện | Xử lý |
|---|---|
| Bộ đếm số lần sai bị vượt khi gửi nhiều lần đoán cùng lúc: mỗi request đã nạp tài khoản của phiên trước khi giữ khoá dòng, và sau khi có khoá vẫn đếm từ số đã nạp. Test dựng lại đúng như vậy: tám lần đoán song song đều nhận 403, tài khoản không bị khoá | Sửa: dòng tài khoản được đọc lại sau khi có khoá (`populate_existing`). Test với session thật và tám luồng: bốn lần được đếm, lần thứ năm khoá, ba lần còn lại nhận 429 |
| Test cho 503 `LOGIN_BUSY` không cho thấy endpoint đổi mật khẩu có giữ chỗ băm | Thêm test: chỗ băm đang được giữ lúc service được gọi |
| Hai lần tạo cùng một email chạy cùng lúc: lần sau bị ràng buộc duy nhất của database từ chối và thành lỗi 500 | Sửa: việc thêm dòng nằm trong một savepoint, lời từ chối đó thành 409 `EMAIL_TAKEN`. Test với hai session thật |
| Form đếm độ dài mật khẩu theo đơn vị UTF-16, server đếm theo ký tự: mật khẩu có ký tự ngoài mặt phẳng cơ bản bị form đánh giá khác server | Sửa: form đếm theo ký tự |
| Trong lúc tài khoản bị khoá tạm, mỗi lần thử vẫn ghi một dòng nhật ký | Không đổi: đăng nhập đã làm vậy từ mốc M5; nhật ký được dọn định kỳ |
| Admin này khoá được admin khác, kể cả admin cuối cùng còn lại ngoài mình; khoá tạm vì nhập sai không kết thúc các phiên đang mở | Không đổi: đúng với đặc tả. Ghi ở "Điều cần biết" |

Bản sửa được chính reviewer đó đọc lại và chấp nhận: lỗi về bộ đếm đã đóng (các chỗ khác đọc bộ đếm đều đi qua cùng một hàm đã đọc lại sau khi có khoá, hoặc không nạp tài khoản từ trước), savepoint không làm hỏng session của bên gọi hay đường tạo tài khoản bằng dòng lệnh, và bản sửa không thêm gì ngoài các phát hiện.

Reviewer không chạy lệnh nào (chỉ đọc mã, patch và các file bằng chứng), và chưa đọc `cli.py`, phần gửi request của frontend, bảng lời văn và CSS.

### Điều cần biết

- Không có "quên mật khẩu" qua email. Người quên mật khẩu nhờ admin đặt lại; admin quên mật khẩu thì nhờ admin khác, hoặc tạo một tài khoản admin mới bằng dòng lệnh.
- Mật khẩu admin đặt không bị ép đổi ở lần đăng nhập đầu.
- Hệ thống không giữ lại admin cuối cùng: một admin khoá được mọi admin khác.
- Khoá tạm vì nhập sai nhiều lần chỉ chặn đăng nhập và đổi mật khẩu; các phiên đang mở vẫn dùng được. Khoá do admin thì kết thúc mọi phiên.
- Khi phiên hết hạn giữa lúc đang ở form đổi mật khẩu, form báo lời chung "chưa đổi được" chứ không đưa về trang đăng nhập.
- Nhánh ném lại lỗi của database khi tạo tài khoản mà email không trùng (một ràng buộc khác bị vi phạm) chưa có test.

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

Bản sửa được chính reviewer đó đọc lại và chấp nhận, kèm hai ghi chú mức thấp:

| Ghi chú | Xử lý |
|---|---|
| Thông báo lỗi của SQLAlchemy chép cả tham số của câu lệnh, nên log của server có thể chứa email vừa thử đăng nhập | Sửa: engine được tạo với `hide_parameters=True` (`tests/test_db.py`) |
| Lỗi chưa lường trước nay thành câu trả lời 500 cả trong test (trước đây test thấy thẳng traceback); client ngắt kết nối giữa chừng cũng bị ghi log như một lỗi | Không đổi: traceback vẫn nằm trong log, và pytest in log khi test thất bại |

Reviewer không chạy được lệnh nào (chỉ đọc mã và log), chưa đọc test đầu-cuối của frontend, và ở lần đọc lại chưa đối chiếu các file số liệu (kết quả test, mutation check, số đo qua nginx).

## Quyết định cho các câu hỏi mở

1. **Ai được tạo tài khoản?** Chỉ admin: tài khoản đầu tiên qua dòng lệnh, các tài khoản sau trên trang quản trị. Tự đăng ký cần xác minh email, tức cần dịch vụ gửi thư.
2. **Nhật ký hành động:** có bảng `audit_log` ngay từ đầu.
