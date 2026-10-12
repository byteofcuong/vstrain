# ADR-002: Địa danh có mã, có hiệu lực theo thời gian, và một bảng tên thay thế

## Status
Accepted

## Date
2026-10-12

## Context
Nextstrain dùng chính chuỗi tên làm khoá của địa danh. `augur curate apply-geolocation-rules` so khớp nguyên văn theo một file luật, và toạ độ cũng tra theo tên trong `lat_longs.tsv`. Phép đo V1 (`do-dac/results/V1-dia-ly-viet-nam/`) cho thấy cách này không chạy được với dữ liệu Việt Nam:

- Trong 4.305 bản ghi dengue Việt Nam trên GenBank, chỉ 88 (2,0%) có tên tỉnh. Phần còn lại để trống (1.999) hoặc ghi vùng, thành phố: "South" 1.455, "Nha Trang" 562, "Red River Delta" 131.
- 331 cách viết của 63 tỉnh đi qua luật của Augur: 30 giá trị được đổi; 245 ra đúng tỉnh nếu bỏ qua khác biệt về dấu và dấu cách; 119 có toạ độ để hiện lên bản đồ.
- Không có mã đơn vị, không có đường biên, không có yếu tố thời gian. Từ 1/7/2025, 63 tỉnh thành còn 34 đơn vị (Nghị quyết 202/2025/QH15), nên cùng một cái tên chỉ hai vùng đất khác nhau tuỳ thời điểm: "Gia Lai" năm 2010 là tỉnh Gia Lai cũ, "Gia Lai" năm 2026 gồm cả Bình Định cũ.

## Decision
1. **Đơn vị có mã, tên chỉ là thuộc tính.** Bảng `admin_unit` có ba cấp (miền, vùng, cấp tỉnh) và hai bộ đơn vị cấp tỉnh: `vn63` và `vn34`.
2. **Hiệu lực theo thời gian.** Tỉnh bộ 63 có `valid_to` = 2025-06-30 và `successor_code` trỏ tới đơn vị bộ 34. Mẫu được gán đơn vị có hiệu lực vào ngày lấy mẫu. Khi không biết ngày, hoặc khoảng ngày vắt qua mốc sáp nhập, mẫu được gán đơn vị kế thừa: đơn vị này rộng hơn nên chắc chắn chứa nơi lấy mẫu.
3. **Cách viết là dữ liệu, không phải mã.** Mọi cách viết đi qua `place_key` (bỏ dấu, chữ thường, bỏ từ hành chính, bỏ dấu cách) rồi tra bảng `place_alias`; một khoá trỏ tới đúng một đơn vị. Tên thay thế có ba loại: tên chính thức, cách viết khác, tên thành phố thuộc tỉnh. Thêm một cách viết mới là thêm một dòng.
4. **Tên thay thế luôn trỏ về tỉnh bộ 63**, rồi quy tắc ngày đưa sang bộ 34. Làm được vì tên của cả 34 đơn vị mới đều là tên một tỉnh cũ (có test giữ điều kiện này).
5. **Cấp vùng là kết quả hợp lệ.** "South" được gán miền Nam chứ không bị bỏ. Mỗi mẫu có một trong bốn trạng thái: `province`, `region`, `missing`, `unresolved`; địa danh gốc được lưu nguyên văn.

## Alternatives Considered

### Giữ cách của Augur: file luật và bảng toạ độ theo tên
- Ưu: đã có sẵn, dùng chung với hệ sinh thái Nextstrain.
- Nhược: so khớp nguyên văn nên mỗi cách viết cần một dòng luật; không có thời gian; không có cấp vùng.
- Loại: đây là nguyên nhân của con số 2%.

### So khớp gần đúng (khoảng cách chỉnh sửa)
- Ưu: bắt được lỗi gõ mà không cần thêm dòng nào.
- Nhược: nhiều tên tỉnh chỉ khác nhau vài chữ ("Ha Nam" và "Ha Noi", "Quang Nam" và "Quang Ngai"), nên có thể gán nhầm tỉnh mà không ai biết.
- Loại: gán sai tệ hơn là chưa gán. Giá trị không khớp được đánh dấu `unresolved` để admin xử lý.

### Dịch vụ geocoding bên ngoài
- Ưu: phủ cả tên huyện, xã.
- Nhược: phụ thuộc mạng và bên thứ ba, gửi dữ liệu ra ngoài, chỉ trả về đơn vị hiện hành.
- Loại: không có yếu tố thời gian và không tự chủ được.

### Chỉ lưu bộ 34 đơn vị hiện hành
- Ưu: một bộ đơn vị, đơn giản hơn.
- Nhược: toàn bộ 4.305 bản ghi hiện có được lấy mẫu trước 2025 và sẽ mất chi tiết cấp tỉnh cũ. Từ bộ 63 gộp lên bộ 34 thì tính được, chiều ngược lại thì không.
- Loại: mất thông tin không lấy lại được.

### Luôn giữ đơn vị chi tiết nhất mà tên gợi ra, kể cả sau sáp nhập
- Ưu: "Binh Dinh" ghi năm 2026 vẫn giữ được phạm vi tỉnh Bình Định cũ.
- Nhược: hai quy tắc cùng tồn tại (tên chỉ có ở bộ cũ thì giữ, tên còn dùng thì đổi), khó giải thích và khó kiểm.
- Loại: chọn một quy tắc duy nhất là "đơn vị có hiệu lực vào ngày lấy mẫu". Địa danh gốc vẫn được lưu nên có thể phân giải lại nếu đổi quy tắc.

## Consequences
- Phép đo W1 (`do-dac/results/W1-dia-danh-webapp/`) trên cùng 331 cách viết: 320 (96,7%) ra đúng tỉnh khi bảng tên thay thế chỉ có tên chính thức, tức chỉ nhờ chuẩn hoá; 331 (100%) khi có thêm các cách viết khác. Con số 100% không nói lên nhiều, vì 16 cách viết khác trong bộ thử cũng chính là dữ liệu đã nạp vào bảng; con số đáng tin là 96,7%.
- Mẫu không có ngày lấy mẫu chỉ được gán đơn vị bộ 34, nên không hiện được trên bản đồ 63 tỉnh.
- Tên cũ dùng sau sáp nhập ("Binh Dinh" năm 2026) mất chi tiết cấp tỉnh cũ.
- Mã đơn vị là mã nội bộ; mã chính thức, đường biên và vùng của 34 đơn vị mới chưa có (`backend/app/geo/data/NGUON.md`).
- Tỉ lệ gán được trên 4.305 bản ghi thật được đo ở task T3.3.
