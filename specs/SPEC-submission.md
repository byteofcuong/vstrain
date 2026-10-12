# Spec: module `submission` (mốc M5, phần nộp mẫu)

Trạng thái: **bản nháp chờ duyệt**.

## Objective

Một phòng xét nghiệm nộp một genome và thấy nó trên cây trong vòng chưa tới một phút, không phải chờ lần build kế tiếp.

Vấn đề đã đo: với Nextstrain, thêm một mẫu là dựng lại toàn bộ (771 giây ở 2.000 chuỗi, 2.020 giây ở 5.000). Prototype A cho thấy Nextclade đặt 100 mẫu vào cây có sẵn trong 1,9 đến 4,4 giây, và hàng xóm gần nhất của mẫu trùng với cây dựng lại ở 88–91% trường hợp (trần của chính phép dựng lại là 94–97%).

## Luồng

1. Người nộp (đã đăng nhập) gửi form: file FASTA, tên mẫu, ngày lấy mẫu (cho phép chỉ có tháng hoặc năm), tỉnh (chọn từ danh sách đơn vị hành chính) và vật chủ.
2. API kiểm tra, lưu mẫu với trạng thái `received`, xếp job `ingest_sample` ưu tiên cao.
3. Worker: gióng theo reference (dùng lại `align_batch`); nếu người nộp không khai serotype thì thử cả bốn reference và lấy kết quả tốt nhất; ghi kết quả kiểm tra chất lượng.
4. Worker: đặt mẫu vào cây của build hiện hành bằng `nextclade run --input-tree`, lưu vào bảng `sample_placement` (build, node gần nhất, số đột biến riêng, genotype).
5. Viewer lấy các tip tạm qua `GET /api/datasets/{slug}/placements` và vẽ chồng lên cây, khác màu và có nhãn "tạm".
6. Lần build kế tiếp đưa mẫu vào cây chính thức; tip tạm của nó được bỏ.

## Thiết kế

- Bảng `sample_placement`: `sample_id`, `build_id`, `parent_node` (tên node trong cây), `private_mutations`, `clade`, `placed_at`.
- File nộp: giới hạn kích thước (mặc định 2 MB), đúng một chuỗi mỗi lần nộp ở phiên bản đầu, chỉ nhận mã nucleotide của IUPAC, độ dài hợp lệ so với reference.
- Tên mẫu là tên hiển thị: lưu nguyên văn, không bao giờ tới công cụ (ADR-003). Cấm ký tự điều khiển và xuống dòng; giới hạn 300 ký tự.
- Ngày lấy mẫu không được ở tương lai. Tỉnh là mã đơn vị, không phải chuỗi tự do; đơn vị phải còn hiệu lực vào ngày lấy mẫu.
- Vị trí của tip tạm trên trục thời gian lấy từ ngày người nộp khai, chưa phải ngày suy diễn; giao diện ghi rõ điều này.

## Tiêu chí nghiệm thu

| # | Tiêu chí | Ngưỡng |
|---|---|---|
| 1 | Từ lúc bấm nộp tới lúc tip tạm có trong `GET .../placements`, dataset ≤ 5.000 tip | ≤ 30 giây |
| 1b | Hàng xóm gần nhất của mẫu đặt tạm trùng với cây dựng lại (dùng lại `protoA_danh_gia.py`) | ≥ 85% trên 100 mẫu để dành |
| 5 | Mẫu tên "Hà_Nội/01/2024" đi trọn luồng nộp, đặt tạm và build | Qua |
| S1 | File không phải FASTA, chuỗi quá ngắn, sai ký tự, quá lớn | Từ chối với lỗi 422 nói rõ lý do, không tạo job |
| S2 | Genome khác serotype của dataset | Được gán đúng serotype hoặc bị từ chối có lý do |
| S3 | Người nộp chỉ thấy và sửa được mẫu của mình | Có test |

## Câu hỏi mở

1. **Mẫu nộp hiện công khai ngay khi đạt kiểm tra chất lượng, hay chờ admin duyệt?** Đề xuất: hiện ngay nhưng gắn nhãn "tạm"; admin có nút ẩn.
2. Một lần nộp nhiều chuỗi (file FASTA nhiều bản ghi kèm bảng metadata)? Đề xuất: để sau phiên bản đầu.
3. Dữ liệu nộp trong đồ án là dữ liệu công khai dùng để thử. Khi có dữ liệu thật của phòng xét nghiệm thì cần thoả thuận chia sẻ dữ liệu; nằm ngoài phạm vi kỹ thuật này.
