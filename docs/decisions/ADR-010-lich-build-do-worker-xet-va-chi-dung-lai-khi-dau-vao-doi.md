# ADR-010: Lịch build do worker tự xét, và cây chỉ được dựng lại khi đầu vào đổi

## Status
Accepted

## Date
2026-10-13

## Context
Tới mốc M5, một lần build chỉ chạy khi có người gõ `python -m app.cli enqueue build_dataset ...` trong container. Mẫu nộp qua giao diện được gắn tạm lên cây (ADR-009) nhưng chỉ thành tip chính thức ở lần build kế tiếp, nên hệ thống cần một thứ tự gọi lần build đó.

Nextstrain đặt lịch ngoài ứng dụng: GitHub Actions chạy lại cả workflow theo giờ, dù dữ liệu có đổi hay không. Một lần dựng DENV1 ở đây mất 682 giây và giữ worker chung trong suốt thời gian đó; dựng lại mỗi đêm một cây không đổi là tốn máy mà không cho ai thứ gì mới.

Hai điều có sẵn làm cho một cách khác khả thi. Việc chọn mẫu là tất định (`selection.py`: cùng dữ liệu cho cùng tập mẫu), nên biết trước được lần build tới có ra cây khác không. Và hàng đợi job nằm trong PostgreSQL (ADR-001, ADR-004), nên "xếp một lần build" chỉ là thêm một dòng.

Cùng mốc này có một câu hỏi gần kề: admin sửa một địa danh chưa khớp thì cây có phải dựng lại không.

## Decision
- **Lịch là một cột của dataset** (`build_interval_hours`, để trống là không tự build), admin đặt trên giao diện.
- **Worker chung tự xét lịch**, mỗi phút một lần, giữa các job. Không có service lập lịch riêng và không dùng cron của hệ điều hành. Worker chỉ nhận `ingest_sample` không xét.
- **Một lần build chỉ được xếp khi tập đầu vào đã đổi.** Mỗi build ghi `inputs_hash`: hash của danh sách mẫu được chọn, vai trò, ngày lấy mẫu và hash chuỗi của từng mẫu. Tới hạn, worker chọn mẫu thử rồi so hash với build đang được phát; bằng nhau thì bỏ qua.
- **So với cây đang được phát, không so với lần thử gần nhất.** Một lần build hỏng không thành build hiện hành, nên nó được thử lại ở chu kỳ sau mà không cần ai bấm gì.
- **Khoảng cách tính từ lần thử gần nhất, kể cả lần hỏng** và kể cả job hỏng trước khi kịp tạo dòng build. Một lỗi lặp lại vì thế tốn nhiều nhất một lần thử mỗi chu kỳ.
- **Mỗi dataset có nhiều nhất một job dựng cây chưa xong.** Việc xét lịch, nút "Dựng ngay" và việc chạy lại một job dựng cây đều khoá dòng của dataset rồi mới kiểm tra điều này.
- **Địa danh và tên hiển thị không nằm trong hash.** Chúng không đổi cây, chỉ đổi các cột thuộc tính của bản publish. Sửa địa danh vì thế xếp một job `publish_build` (viết lại các cột từ database, dùng lại cây đã dựng) chứ không xếp job dựng cây.
- **Job hỏng không tự chạy lại; admin chạy lại bằng một job mới**, job cũ giữ nguyên. Quy tắc này có từ ADR-004; mốc này thêm nút bấm và cột `retry_of`.

## Alternatives Considered

### Service lập lịch riêng (cron trong container, APScheduler, Celery beat)
- Ưu: tách việc "khi nào" khỏi việc "chạy".
- Nhược: thêm một tiến trình phải theo dõi, hoặc thêm một dependency; với cron trong container, lịch nằm trong file cấu hình chứ không nằm cùng dữ liệu, nên giao diện không đặt được.
- Loại: việc phải làm chỉ là một câu truy vấn mỗi phút, và worker đang có sẵn một vòng lặp.

### Dựng lại theo giờ cố định, không xét đầu vào
- Ưu: không cần hash; hành vi dễ đoán.
- Nhược: mỗi lần là 682 giây máy cho một cây giống hệt, và trong lúc đó việc gắn lại mẫu tạm phải chờ.
- Loại: chi phí của việc xét (một lần chọn mẫu và một câu truy vấn hash) nhỏ hơn nhiều so với một lần build thừa.

### Dựng lại ngay khi có mẫu mới được nhận
- Ưu: tip tạm thành tip chính thức sớm nhất có thể.
- Nhược: mười mẫu nộp trong một buổi sáng là mười lần build nối đuôi nhau; đây chính là chi phí mà ADR-009 tránh.
- Loại: tip tạm đã cho người nộp câu trả lời trong khoảng một giây; cây chính thức không cần nhanh tới vậy.

### Biết đầu vào đổi bằng cách so thời điểm (mẫu nào mới hơn lần build trước)
- Ưu: không phải chọn mẫu thử.
- Nhược: không thấy mẫu bị ẩn hay bị sửa ngày; và một mẫu mới không lọt vào tập được chọn (vì trần số mẫu) vẫn gây ra một lần build cho ra đúng cây cũ.
- Loại: hash của chính tập được chọn trả lời đúng câu hỏi cần hỏi.

### Dựng lại cây khi sửa địa danh
- Ưu: chỉ có một đường cập nhật.
- Nhược: 682 giây cho một thay đổi không đụng tới cây.
- Loại: bản publish theo hash (ADR-006) làm cho việc viết lại riêng các cột là an toàn: bản cũ không bị sửa, bản mới có địa chỉ mới.

## Consequences
- Mẫu nộp thành tip chính thức mà không ai gõ lệnh: test với công cụ thật chạy vòng lặp của worker, lịch xếp đúng một build, và lần xét ngay sau đó không xếp thêm.
- Sửa một địa danh trên database thật: lời gọi API mất 71 ms (trung vị 5 lần, phân giải lại 4.306 bản ghi GenBank trong nước); job publish lại cây 1.964 tip mất 0,17 giây (trung vị 3 lần), so với 682 giây của lần dựng cây gần nhất. `tree.json` giữ nguyên từng byte. Số đo ở `do-dac/results/W8-van-hanh/sua_dia_danh.json`.
- Hash không thấy những thay đổi làm cây khác đi mà không đổi mẫu, ngày hay chuỗi: đổi phiên bản công cụ, đổi tham số của pipeline, đổi định nghĩa clade. Sau những thay đổi đó admin phải bấm "Dựng ngay".
- Build có từ trước mốc này không có hash. Dataset nào được bật lịch sẽ được dựng lại một lần ở chu kỳ đầu.
- Lịch chỉ được xét khi worker chung đang chạy và không kẹt trong một job dài; một lần build đang chạy làm việc xét của các dataset khác trễ tới khi nó xong. Với một worker chung thì đằng nào chúng cũng phải chờ.
- Sửa địa danh có thể làm đổi tập mẫu được chọn (mẫu trong nước được chia nhóm theo tỉnh và năm). Khi đó cột của cây hiện hành đổi ngay, còn cây đổi ở lần build theo lịch kế tiếp.
- Bản publish cũ không bị xoá khi có bản mới (1,7 MB mỗi bản ở DENV1). Chưa có việc dọn chúng.
