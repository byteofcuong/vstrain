# Spec: module `evaluation` (mốc M7)

Trạng thái: **đã xong** (2026-10-13). Kết quả ở `docs/KET-QUA.md` và Checkpoint I của `tasks/todo.md`.

## Objective

Trả lời bằng số đo câu hỏi mà đồ án đặt ra: năm vấn đề đã đo được ở Nextstrain có được xử lý trong ứng dụng này không. Mỗi tiêu chí ở mục Success Criteria của `SPEC.md` phải có một kết quả, một file số liệu và một câu nói rõ giới hạn của phép đo. Người đọc repo (README) phải chạy được ứng dụng và tìm được các số đó.

Module này không thêm tính năng. Nó chỉ đo, và sửa lỗi nếu phép đo tìm ra lỗi.

## Việc phải làm

| # | Việc | Vì sao còn thiếu |
|---|---|---|
| E1 | Tiêu chí 1 trên một cây 5.000 tip: thời gian từ lúc nộp tới lúc tip tạm công khai | Mốc M5 mới đo ở cây 1.964 tip |
| E2 | Thời gian build ở 5.000 mẫu, từng bước, so với bảng P1 của Nextstrain | Lợi ích của việc gióng sẵn ở 5.000 mẫu chưa được đo (bước `align` của P1 mất 318 giây ở cỡ này) |
| E3 | Tiêu chí 1b trên ứng dụng: giấu 100 mẫu khỏi cây DENV1, dựng lại, gắn tạm từng mẫu bằng đúng hàm mà job nộp mẫu gọi, so hàng xóm gần nhất với cây đầy đủ. Kèm trần của chỉ số: hai lần dựng lại đầy đủ so với nhau | Mới có số của prototype (88–91%, trần 94–97%) |
| E4 | Chạy lại harness của viewer trên bản cuối, dataset 35 nghìn tip | Số của mốc M3 có trước khi thêm bản đồ, tip tạm và các trang quản trị |
| E5 | Chạy lại báo cáo địa danh và các test an toàn trên bản cuối | Xác nhận số của mốc M1 và M2 còn đúng |
| E6 | `docs/KET-QUA.md`: bảng trước và sau cho từng tiêu chí, kèm cách đo, file số liệu và giới hạn | |
| E7 | `README.md`: ứng dụng là gì, chạy thế nào, test thế nào, tài liệu ở đâu | Repo chưa có README |

## Tiêu chí nghiệm thu

- Mỗi dòng của bảng Success Criteria có kết quả đo trên ứng dụng, hoặc ghi rõ "chưa đo" kèm lý do.
- Mỗi số trong `docs/KET-QUA.md` và `README.md` tìm lại được trong một file số liệu hoặc một test có tên.
- Kết quả không đạt ngưỡng được ghi là không đạt; ngưỡng không được sửa sau khi đo.
- Các lệnh trong README đều đã được chạy thật trên stack này. (Chưa thử từ một bản clone mới trên máy khác: stack đang chạy giữ các cổng và volume mà một bản thứ hai cần.)
- Sau khi đo, database và thư mục build không còn dataset tạm, tài khoản tạm hay mẫu tạm.

## Ngoài phạm vi

- Đo dưới tải (nhiều người dùng cùng lúc), đo qua mạng chậm, đo trên máy khác.
- Đánh giá chất lượng khoa học của cây (cách chọn mẫu bối cảnh).
- Số liệu của ba serotype còn lại; mọi phép đo dùng DENV1.
