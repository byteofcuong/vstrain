# ADR-004: Các bước pipeline là hàm Python, trạng thái nằm trong DB

## Status
Accepted

## Date
2026-10-12

## Context
Nextstrain điều phối pipeline bằng Snakemake. Snakemake suy ra việc cần làm từ file trên đĩa, và báo tiến độ qua log trên terminal. Với giám sát vận hành, cách này có ba hạn chế:

- Giao diện không biết job đang ở bước nào, mất bao lâu, lỗi ở đâu, trừ khi tự đọc và phân tích log.
- Phép đo P8 cho thấy ingest chỉ có hai trạng thái: không làm gì (file đã có) hoặc làm lại tất cả.
- Số đo từng bước phải bật riêng (`benchmark:`) và nằm trong file, không truy vấn được.

Hệ thống này chạy trên một máy, mỗi build có khoảng mười bước tuần tự, không cần một đồ thị phụ thuộc tổng quát.

## Decision
- Mỗi loại job là một hàm Python (handler). Mỗi bước là một lần gọi `context.step(...)` hoặc `context.run_tool(...)`.
- Mỗi bước là một dòng `job_step`, được commit ngay khi bắt đầu và khi kết thúc: tên, trạng thái, thời gian, CPU time, đỉnh bộ nhớ, đuôi log.
- Worker là một tiến trình lấy job từ bảng `job` (ADR-001). Lỗi của handler làm job thành `failed`, worker chạy tiếp.
- Worker báo nhịp 15 giây một lần bằng kết nối riêng. Job `running` im lặng quá 90 giây bị đánh dấu `failed`; hệ thống không tự chạy lại.
- Cache giữa các lần build không nằm ở file trung gian mà ở dữ liệu theo mẫu trong DB (chuỗi đã gióng, ADR-005).

## Alternatives Considered

### Chạy Snakemake bên trong worker
- Ưu: dùng lại được workflow có sẵn của Nextstrain; có cache theo file.
- Nhược: trạng thái vẫn nằm trong file và log; muốn hiển thị phải phân tích log; workflow của Nextstrain dùng tên mẫu gốc và các lệnh đi qua shell (ADR-003).
- Loại: giữ lại đúng những điểm cần thay.

### Công cụ điều phối chuyên dụng (Airflow, Prefect, Dagster)
- Ưu: có sẵn giao diện, lịch chạy, thử lại.
- Nhược: thêm một hệ thống phải cài, chạy và học, cho một pipeline tuần tự mười bước trên một máy.
- Loại: chi phí vận hành lớn hơn bài toán.

### Tự động chạy lại job bị bỏ dở
- Ưu: không cần người can thiệp.
- Nhược: job bỏ dở có thể đã ghi một phần kết quả; chạy lại lặp vô hạn nếu job luôn làm worker chết (hết bộ nhớ).
- Loại ở giai đoạn này: đánh dấu `failed` và để người vận hành quyết định.

## Consequences
- Giao diện đọc tiến độ, thời gian và log của từng bước bằng một câu truy vấn; số đo từng bước dùng thẳng cho chương đánh giá.
- Mất cache theo file của Snakemake: build thất bại ở bước cuối phải chạy lại từ đầu. Chấp nhận được vì bước đắt nhất trước đây có thể cache (gióng hàng) nay đã nằm trong DB theo từng mẫu.
- Thêm pathogen là thêm cấu hình và, nếu cần, mã Python; không viết Snakefile.
- Dừng container worker giữa chừng làm job đang chạy thất bại sau tối đa 90 giây.
