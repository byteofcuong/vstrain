# ADR-003: Pipeline chỉ thấy mã nội bộ; công cụ ngoài được gọi bằng danh sách đối số

## Status
Accepted

## Date
2026-10-12

## Context
Phép đo P6 (`do-dac/results/P6-an-toan/`) cho thấy Augur không an toàn khi đặt sau một form web:

- Mẫu tên "Hà_Nội/01/2024" làm `augur tree` thoát mã 2: IQ-TREE đổi ký tự ngoài ASCII thành `_`, tên trong cây không còn khớp tên trong alignment.
- Tên có dấu `'` hoặc `\` bị từ chối.
- `--tree-builder-args "...; touch file"` chạy được lệnh `touch`. Lý do: Augur ghép lệnh thành một chuỗi rồi đưa cho bash (`augur/io/shell_command_runner.py`, `augur/tree.py:315-329`).

Augur ghép chuỗi lệnh ở `align`, `tree`, `mask`, `merge` và ở các hàm đọc, ghi chuỗi mà `filter` dùng. Với Nextstrain điều này chấp nhận được, vì người chạy pipeline cũng là người viết cấu hình. Với một hệ thống nhận mẫu từ nhiều phòng xét nghiệm thì tên mẫu là dữ liệu của người ngoài.

## Decision
1. **Mã nội bộ.** Mỗi mẫu có `internal_id` do database sinh (`S0000123`): chỉ có chữ ASCII và số, có chữ cái đứng đầu để không bị đọc thành số. File đưa cho công cụ chỉ chứa mã này và ngày lấy mẫu. Tên hiển thị, địa danh và mọi thuộc tính khác nằm trong DB, được ghép vào kết quả lúc publish.
2. **Một cửa duy nhất để chạy tiến trình ngoài** (`app/jobs/tools.py::run_tool`):
   - lệnh là danh sách đối số, không có shell;
   - chỉ chạy công cụ có tên trong danh sách cho phép (`augur`, `nextclade`, `iqtree`); đường dẫn hay tên khác bị từ chối trước khi chạy;
   - tiến trình con nhận một môi trường tối thiểu, không có URL và mật khẩu database;
   - có giới hạn thời gian; quá hạn thì dừng cả nhóm tiến trình;
   - mỗi job một thư mục làm việc riêng.
3. **Tham số của công cụ lấy từ cấu hình pathogen trong repo**, không lấy từ dữ liệu của request.
4. **Build không dùng lệnh nào của Augur có đi qua shell:** gióng hàng bằng Nextclade, chọn mẫu bằng SQL, dựng cây gọi thẳng IQ-TREE với đúng các đối số mà `augur tree` dùng (`--ninit 2 -n 2 --epsilon 0.05 -T AUTO --redo`, mô hình GTR). Các lệnh còn lại (`refine`, `ancestral`, `translate`, `clades`, `export v2`) không gọi shell với đầu vào FASTA và JSON.

## Alternatives Considered

### Làm sạch hoặc escape tên mẫu rồi vẫn đưa cho công cụ
- Ưu: không cần bảng ánh xạ.
- Nhược: danh sách ký tự nguy hiểm không bao giờ đủ; mỗi công cụ lại có luật riêng (IQ-TREE tự đổi ký tự). Augur đã đi hướng này và vẫn hỏng với tên có dấu.
- Loại: chặn theo danh sách đen thì sót, còn mã nội bộ thì đúng theo cách dựng.

### Giữ shell nhưng bọc mọi đối số bằng `shlex.quote`
- Ưu: sửa ít.
- Nhược: an toàn phụ thuộc vào việc không quên bọc ở chỗ nào; một chỗ sót là chạy được lệnh tuỳ ý.
- Loại: không có shell thì không có gì để quên.

### Mỗi job chạy trong một container riêng, không có mạng
- Ưu: cô lập mạnh hơn, kể cả khi công cụ có lỗ hổng.
- Nhược: worker phải điều khiển Docker, khởi động chậm hơn, phức tạp hơn nhiều.
- Chưa làm: đây là lớp phòng thủ bổ sung, không thay được hai quyết định trên. Có thể thêm sau.

## Consequences
- Tên mẫu có thể là bất cứ chuỗi nào; đổi tên hiển thị hay sửa địa danh không cần dựng lại cây.
- Kết quả của công cụ phải được nối ngược về mẫu qua mã nội bộ.
- Thêm một công cụ mới phải sửa danh sách cho phép trong mã, tức là qua review.
- Đã kiểm bằng test: các đối số `; touch x`, `$(touch x)`, `` `touch x` `` tới được công cụ nguyên văn và không tạo file. Khi cố ý đổi lời gọi sang `shell=True`, test này thất bại.
- Đỉnh bộ nhớ đo bằng `wait4` không thấp hơn bộ nhớ của chính worker (khoảng 74 MB), vì tiến trình con được tách ra từ worker; với các bước nặng thì sai số này không đáng kể.
