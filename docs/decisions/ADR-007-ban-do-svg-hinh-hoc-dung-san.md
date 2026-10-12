# ADR-007: bản đồ vẽ bằng SVG, hình học dựng sẵn từ hai nguồn

## Status
Accepted

## Date
2026-10-13

## Context
Mốc M4 cần một bản đồ Việt Nam tô theo địa bàn, dùng chung bộ lọc với cây. Kế hoạch ban đầu ghi "MapLibre GL với lớp đa giác tỉnh, không cần tile nền" và "đường biên 34 đơn vị tính bằng cách gộp các đa giác cũ".

Những gì đo và kiểm tra được trước khi làm:

- **Dữ liệu mỏng ở cấp tỉnh.** Build DENV1 có 1.489 mẫu Việt Nam: 209 mẫu biết tỉnh (2 tỉnh), 925 mẫu biết vùng hoặc miền, 564 mẫu không biết gì. Bản đồ chỉ có cấp tỉnh sẽ bỏ qua 86% số mẫu.
- **Số phần tử phải vẽ rất nhỏ:** 3 miền, 6 vùng, 63 hoặc 34 tỉnh.
- **CSP của bản triển khai** (`default-src 'self'`, ADR-006) chặn worker tạo từ `blob:`, là cách MapLibre GL chạy mặc định.
- **Nguồn đường biên:** không nguồn nào có giấy phép rõ ràng mà đủ cả hai bộ tỉnh. HDX COD-AB (OCHA công bố, nguồn Tổng cục Thống kê, CC BY-IGO) chỉ có 34 đơn vị hiện hành. geoBoundaries (public domain, hình lấy từ Wikipedia, năm 2008) chỉ có 63 tỉnh. GADM cấm phân phối lại. Bản đồ của Cục Đo đạc và Bản đồ không ghi điều khoản dùng lại.
- Trong cả hai file, đường biên giữa hai tỉnh kề nhau trùng nhau từng đỉnh (69% cạnh của file geoBoundaries có cạnh ngược chiều ở tỉnh bên cạnh, không có cạnh chồng lấn).

## Decision
- **Vẽ bằng SVG tự viết, không thêm thư viện.** Mỗi địa bàn là một phần tử `<path>`; bấm, focus bằng bàn phím và tên cho trình đọc màn hình dùng cơ chế có sẵn của DOM.
- **Ba cấp: miền, vùng, tỉnh;** cấp tỉnh có bộ 34 và bộ 63. Mẫu không xếp được ở cấp đang xem được đếm riêng và ghi rõ.
- **Hai nguồn, mỗi nguồn cho phần nó có:** bộ 34 lấy từ HDX; bộ 63 lấy từ geoBoundaries; 6 vùng và 3 miền gộp từ bộ 63 (người làm đồ án chọn ngày 2026-10-13). Nguồn, giấy phép và mã băm ghi ở `frontend/map-data/NGUON.md`.
- **Hình học dựng sẵn lúc phát triển** (`npm run build:map`), ghi thành một file JSON có đường vẽ đã chiếu sẵn; trình duyệt không tính hình. File là asset có hash, chỉ tải khi bảng bản đồ mở.
- **Gộp tỉnh bằng cách khử cạnh chung:** cạnh nào có cạnh ngược chiều trong nhóm thì là cạnh trong và bị bỏ, các cạnh còn lại nối thành đường bao. Không cần thư viện hình học.
- **Rút gọn bằng cách ghim đỉnh vào lưới.** File HDX có 1,3 triệu đỉnh; ghim vào lưới 0,01 độ còn 20 nghìn. Cùng một đỉnh luôn về cùng một chỗ nên đường biên chung không hở.
- **Phép chiếu:** kinh độ, vĩ độ tỉ lệ đều, kinh độ nhân cos 16°. Khung vẽ gồm cả đất liền và hai quần đảo ở đúng vị trí, không dùng khung phụ.
- **Hoàng Sa và Trường Sa:** mỗi đảo là một chấm, vì hình thật nhỏ hơn một pixel; có nhãn. Quần đảo thuộc địa bàn nào do file nguồn quyết định (Đà Nẵng và Khánh Hòa ở cả hai nguồn).

## Alternatives Considered

### MapLibre GL (như kế hoạch ban đầu)
- Ưu: có sẵn phóng to, kéo, chiếu Mercator; quen thuộc.
- Nhược: thêm khoảng 800 KB JavaScript (bundle hiện tại 262 KB) cho tối đa 63 đa giác; cần WebGL (test đầu-cuối trên Chromium headless kém ổn định hơn); phải nới CSP hoặc dùng bản build riêng cho CSP; không tự giải quyết việc gộp tỉnh.
- Loại. Cái giá: không có phóng to và kéo bản đồ; tỉnh nhỏ ở đồng bằng sông Hồng chỉ rộng 7–10 pixel, nên có thêm danh sách địa bàn bấm được.

### Chỉ dùng geoBoundaries, bộ 34 gộp từ 63
- Ưu: một nguồn, đường biên nhất quán giữa các lớp, public domain.
- Nhược: bộ hiện hành lại dựng từ hình lấy ở Wikipedia, năm 2008.
- Không chọn: người làm đồ án muốn bộ hiện hành đến từ nguồn uy tín nhất có giấy phép rõ ràng.

### Gộp và rút gọn bằng mapshaper hoặc shapely
- Ưu: công cụ chuẩn, rút gọn mịn hơn ghim lưới.
- Nhược: thêm một công cụ phải cài và xin phép; hai phép tính cần dùng đều viết được trong vài chục dòng và kiểm được bằng diện tích.
- Loại.

### Khung phụ cho hai quần đảo, để đất liền chiếm trọn khung
- Ưu: đất liền lớn hơn khoảng 1,2 lần ở cùng chiều cao.
- Nhược: hai quần đảo nằm sai vị trí và sai tỉ lệ, thêm mã cho hai phép chiếu phụ.
- Loại: lợi ích nhỏ vì hình chữ S của đất liền bị giới hạn bởi chiều cao, không phải bề ngang.

## Consequences
- Không thêm dependency nào. File hình học 138 KB (25 KB khi nén gzip), không nằm trong bundle chính.
- Hai lớp tỉnh đến từ hai nguồn nên đường bờ biển và đường biên lệch nhau chút ít khi đổi giữa bộ 63 và bộ 34. Chấp nhận: mỗi lớp được vẽ riêng, không chồng lên nhau.
- Có phép kiểm chéo giữa hai nguồn cho bảng gộp 63 → 34 của backend: diện tích mỗi đơn vị bộ 34 (hình HDX) so với tổng diện tích các tỉnh gộp vào nó (hình geoBoundaries) lệch dưới 10% ở 33 trên 34 đơn vị, nhiều nhất 15% (Hải Phòng).
- Mã tỉnh của Tổng cục Thống kê cho 34 đơn vị nay có trong file hình học (thuộc tính `pcode` của HDX), chưa đưa vào bảng `admin_unit`.
- Phải ghi nguồn trên giao diện (yêu cầu của CC BY-IGO) và nói rõ đây là sơ đồ, không phải bản đồ đo đạc.
- Đổi file seed địa danh của backend hoặc file nguồn thì phải chạy lại `npm run build:map`; một test so file đã lưu với kết quả dựng lại sẽ báo nếu quên.
