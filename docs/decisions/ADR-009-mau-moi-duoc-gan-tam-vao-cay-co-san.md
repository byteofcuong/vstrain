# ADR-009: Mẫu mới được gắn tạm vào cây có sẵn; cây chỉ được dựng lại theo lịch

## Status
Accepted

## Date
2026-10-13

## Context
Với Nextstrain, thêm một mẫu là chạy lại cả pipeline. Phép đo P1 trên DENV1: 771 giây ở 2.000 chuỗi, 2.020 giây ở 5.000, và thời gian tăng nhanh hơn tuyến tính. Một phòng xét nghiệm vừa giải trình tự xong một ca bệnh phải chờ lần build kế tiếp mới biết mẫu của mình nằm gần những mẫu nào.

Prototype A đã đo một cách khác: Nextclade so mẫu với các node của một cây có sẵn và gắn nó vào chỗ gần nhất. 100 mẫu vào cây 4.900 tip mất 1,9 đến 4,4 giây; hàng xóm gần nhất của mẫu trùng với cây dựng lại ở 88–91% trường hợp, trong khi hai lần dựng lại độc lập cũng chỉ trùng nhau 94–97%.

Build của hệ thống này đã xuất cây ở dạng Nextclade dùng được làm cây nền (gốc cây được so với reference, ADR-005), và mỗi mẫu đã có mã nội bộ không phụ thuộc tên do người dùng gõ (ADR-003).

## Decision
- **Hai đường cho một mẫu mới.** Ngay khi nộp, mẫu được kiểm tra rồi gắn tạm vào cây của build hiện hành (job `ingest_sample`, vài giây). Cây đầy đủ vẫn chỉ được dựng theo lịch; lần build kế tiếp chọn cả mẫu đã nộp, và mẫu thành một tip chính thức.
- **Tip tạm không nằm trong file của build.** File publish của một build bất biến và được trình duyệt giữ vĩnh viễn (ADR-006). Tip tạm nằm trong bảng `sample_placement`, viewer lấy qua API và vẽ chồng lên cây, bằng hình khác với tip của build.
- **Chỗ gắn được lưu bằng tên node của cây gốc**: node gần nhất phía trên mẫu, và (nếu Nextclade chẻ một cành) node ở đầu dưới của cành đó, kèm độ phân kỳ tại điểm gắn và của mẫu. Tên node chỉ có nghĩa với cây của đúng build đó, nên khoá của bảng là (mẫu, build), API chỉ trả chỗ gắn trên build hiện hành, và sau mỗi build một job gắn lại các mẫu mà cây mới chưa có.
- **API đổi tên node thành chỉ số** trong `tree.json` của bản publish đang được phát. Viewer giữ cây bằng mảng số và không giữ tên của node trong.
- **Mẫu vừa nộp chưa công khai.** `sample.status` đi từ `received` sang `accepted` hoặc `rejected`; chỉ mẫu `accepted` có mặt trong API công khai, trong tip tạm và trong build. Admin đổi được giữa `accepted` và `hidden`.
- **Người nộp không khai serotype.** Mẫu được gióng thử theo reference của từng serotype; kết quả gần nhất được giữ.
- **Worker riêng cho mẫu nộp.** Hàng đợi chỉ có một bảng, nhưng một worker chỉ nhận `ingest_sample`, để một mẫu nộp trong lúc worker chung đang dựng cây (hàng chục phút) không phải chờ.
- **Trên trục thời gian, tip tạm đứng ở ngày lấy mẫu do người nộp khai.** Nextclade không suy ra ngày; giao diện ghi rõ điều này.

## Alternatives Considered

### Dựng lại cây ở mỗi lần nộp
- Ưu: chỉ có một loại vị trí, không có khái niệm "tạm".
- Nhược: 771 giây ở 2.000 chuỗi cho một mẫu; hai mẫu nộp liền nhau là hai lần dựng lại.
- Loại: đây chính là vấn đề cần giải.

### Ghi tip tạm vào file của build (publish lại sau mỗi lần nộp)
- Ưu: viewer chỉ đọc một nguồn.
- Nhược: mỗi lần nộp tạo một bản publish mới (toàn bộ `tree.json` đổi hash), trình duyệt phải tải lại cả cây; chỉ số của mọi tip phía sau bị dịch đi, nên bố cục và các cột thuộc tính phải tính lại.
- Loại: bản publish bất biến là điều làm cho cache và việc sửa địa danh rẻ; không đổi nó lấy sự gọn của một nguồn.

### Gắn bằng UShER
- Ưu: được thiết kế cho việc gắn mẫu vào cây rất lớn (hàng triệu tip).
- Nhược: thêm một công cụ và một định dạng cây (protobuf) vào image; cỡ cây ở đây là vài nghìn tip, nơi Nextclade mất chưa tới một giây.
- Chưa cần. Phải xét lại nếu một dataset vượt vài chục nghìn tip.

### Lưu chỗ gắn bằng chỉ số node thay vì tên
- Ưu: API không phải tra tên.
- Nhược: chỉ số phụ thuộc thứ tự duyệt cây lúc publish; nếu cách làm phẳng cây đổi, chỗ gắn đã lưu trỏ sai chỗ mà không báo lỗi gì.
- Loại: tên là thứ Nextclade trả về và là thứ bền; chỉ số được tra từ đúng file đang phát, lúc trả lời.

## Consequences
- Từ lúc gửi form tới lúc mẫu là tip tạm công khai: trung vị 1,07 giây trên build DENV1 thật (1.964 tip, 20 lần, qua nginx), so với 771 giây nếu dựng lại. Số đo ở `do-dac/results/W7-nop-mau/`.
- Vị trí của tip tạm là ước lượng: theo prototype A, khoảng một phần mười số mẫu sẽ có hàng xóm gần nhất khác đi sau khi cây được dựng lại. Giao diện gọi nó là "tạm" ở mọi nơi nó xuất hiện. Độ chính xác trên chính ứng dụng chưa được đo (mốc M7).
- Có một khoảng thời gian mẫu ở hai trạng thái nối tiếp nhau trong cùng một job: đã được nhận, rồi mới được gắn. API coi mẫu là "đang xử lý" cho tới khi job thử gắn xong.
- Tip tạm không có mặt trong các cột thuộc tính của build, nên chưa lọc được theo thuộc tính và chưa lên bản đồ.
- Mỗi build mới phải gắn lại các mẫu còn đứng ngoài; mỗi mẫu là một lần chạy Nextclade (khoảng 0,4 giây). Số mẫu tạm vì thế phải có trần: một tài khoản nộp được nhiều nhất 200 mẫu trong 24 giờ.
- Một lần gắn bị lỗi không được chặn các lần gắn khác: job thử hết rồi mới kết thúc là hỏng. Mẫu đạt kiểm tra mà chưa gắn được vẫn công khai và vẫn vào lần build kế tiếp.
- Mẫu bị ẩn sau khi đã nằm trong một build đã publish vẫn còn trong file của build đó cho tới lần build kế tiếp.
