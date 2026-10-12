# ADR-001: PostgreSQL là nguồn sự thật, backend viết bằng Python

## Status
Accepted

## Date
2026-10-12

## Context
Nextstrain không có cơ sở dữ liệu: mỗi dataset là một file JSON dựng sẵn, server chỉ phát file (`nextstrain.org/src/routing/charon.js:10-28`, bốn route đều trả nguyên file). Hệ quả đã ghi trong báo cáo đo đạc: không trả lời được câu "mẫu của tỉnh X trong tháng Y" ở phía server, không có trạng thái theo từng mẫu để cập nhật tăng dần, không có luồng nộp mẫu.

Hệ thống này cần:
- bản ghi theo từng mẫu, truy vấn theo địa danh và thời gian;
- hàng đợi job cho việc nạp mẫu và dựng cây;
- gọi được Augur và Nextclade (đều là công cụ dòng lệnh, Augur viết bằng Python);
- chạy trên một máy 16 GB RAM, do một người vận hành.

## Decision
- PostgreSQL 16 lưu mẫu, chuỗi, địa danh, build và job.
- Hàng đợi job là một bảng trong PostgreSQL, worker lấy job bằng `SELECT ... FOR UPDATE SKIP LOCKED`.
- Backend viết bằng Python (FastAPI, SQLAlchemy 2); API và worker dùng chung một gói mã.
- Triển khai bằng Docker Compose.

## Alternatives Considered

### Giữ mô hình file tĩnh của Nextstrain
- Ưu: không cần backend, hosting gần như miễn phí.
- Nhược: không có truy vấn theo mẫu, không cập nhật tăng dần, không nộp mẫu.
- Loại: đây chính là giới hạn mà đồ án muốn vượt qua.

### PostgreSQL kèm Redis và Celery cho hàng đợi
- Ưu: hàng đợi chuyên dụng, nhiều tính năng sẵn có.
- Nhược: thêm hai thành phần phải chạy và giám sát; trạng thái job nằm ngoài DB nên khó hiển thị và khó truy vết.
- Loại: tải dự kiến là vài job mỗi phút; một bảng trong PostgreSQL là đủ và mọi trạng thái nằm một chỗ.

### SQLite
- Ưu: không cần cài đặt.
- Nhược: một tiến trình ghi tại một thời điểm, trong khi API và worker ghi đồng thời; không có `SKIP LOCKED`.
- Loại: không hợp với mô hình API cộng worker.

### Backend bằng TypeScript
- Ưu: một ngôn ngữ cho cả frontend và backend.
- Nhược: worker vẫn phải gọi công cụ Python; mất khả năng dùng lại mã xử lý dữ liệu sinh học bằng Python (Biopython có sẵn trong image).
- Loại: lợi ích một ngôn ngữ nhỏ hơn chi phí ở phía worker.

## Consequences
- Mỗi mẫu là một dòng truy vấn được; câu hỏi theo tỉnh và thời gian là một câu SQL.
- Trạng thái job, từng bước và log nằm trong DB, giao diện đọc trực tiếp.
- Chỉ có một thành phần lưu trữ cần sao lưu.
- Hàng đợi trong PostgreSQL không hợp nếu tải lên tới hàng nghìn job mỗi giây; khi đó cần thay phần hàng đợi (xem lại ADR này).
- Thay đổi schema phải qua migration Alembic.
