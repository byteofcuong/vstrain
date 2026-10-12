# Spec: module `map` (mốc M4)

Trạng thái: **đã triển khai** (2026-10-13; tám tiêu chí nghiệm thu đều đạt, số đo ở mục "Checkpoint F" của `tasks/todo.md`). Nguồn đường biên được đồng ý ngày 2026-10-13: HDX cho bộ 34, geoBoundaries cho bộ 63. Lý do của các lựa chọn kiến trúc ở ADR-007. Những chỗ triển khai khác bản nháp ghi ở mục "Thay đổi so với bản nháp".

## Objective

Người xem thấy mẫu của Việt Nam nằm ở đâu, ở đúng cấp địa bàn mà dữ liệu cho phép, và dùng bản đồ như một bộ lọc: bấm vào một địa bàn thì cây, chú giải và bản đồ cùng đổi theo.

Vấn đề đã đo ở Nextstrain (báo cáo đo đạc, mục V1): metadata chỉ có một cột địa danh dạng chữ; 2% bản ghi dengue của Việt Nam ra được tỉnh; không có đường biên, không có khái niệm đơn vị hành chính đổi theo thời gian (63 tỉnh trước 1/7/2025, 34 đơn vị sau đó).

## Dữ liệu hiện có (đo ngày 2026-10-13)

| | Mẫu Việt Nam | Biết tỉnh | Biết vùng hoặc miền | Không biết gì |
|---|---|---|---|---|
| Toàn bộ DB | 4.305 | 782 (12 tỉnh) | 2.306 | 1.999 |
| Build DENV1 | 1.489 | 209 (2 tỉnh) | 925 | 564 |

Phần lớn mẫu công khai chỉ khai tới miền ("South Vietnam"). Bản đồ chỉ tô theo tỉnh sẽ bỏ qua 86% mẫu Việt Nam của build DENV1, nên bản đồ phải vẽ được ở ba cấp và nói rõ bao nhiêu mẫu không xếp được ở cấp đang xem.

## Phạm vi

Có:
- Bảng bản đồ cạnh cây, vẽ Việt Nam ở một trong ba cấp: **miền** (3), **vùng** (6), **tỉnh**; cấp tỉnh có hai bộ: **34 đơn vị** (từ 1/7/2025) và **63 tỉnh** (trước đó).
- Tô màu theo số mẫu đang hiện (sau mọi bộ lọc) của từng địa bàn; chú giải thang màu.
- Rê chuột hoặc focus bằng bàn phím: tên địa bàn, số mẫu đang hiện trên tổng số.
- Bấm vào một địa bàn: bật, tắt bộ lọc theo địa bàn đó. Bộ lọc này giữ những tip được xếp vào các địa bàn đã chọn, và áp dụng chung cho cây, chú giải và dòng đếm.
- Dòng tóm tắt: bao nhiêu mẫu Việt Nam xếp được ở cấp đang xem, bao nhiêu không.
- Danh sách địa bàn có mẫu, xếp theo số mẫu (dạng bảng, cho người không dùng được bản đồ).
- Quần đảo Hoàng Sa (thuộc Đà Nẵng) và Trường Sa (thuộc Khánh Hòa) có trên bản đồ, có nhãn.
- Tiếng Việt và tiếng Anh.

Không: bản đồ thế giới, tile nền, phóng to và kéo bản đồ, đường lây truyền giữa các địa bàn, animation theo thời gian, cấp huyện và xã, chuẩn hoá theo dân số.

## Quy tắc xếp mẫu vào địa bàn

Mỗi tip có tối đa một giá trị ở cột `unit` (mã tỉnh, `vn63:…` hoặc `vn34:…` tuỳ ngày lấy mẫu) và một giá trị ở cột `region` (mã vùng `vnr:…` hoặc mã miền `vnm:…`).

| Cấp đang xem | Tip được xếp vào |
|---|---|
| Tỉnh, bộ 63 | tỉnh của nó, nếu mã thuộc bộ 63 |
| Tỉnh, bộ 34 | đơn vị của nó nếu mã thuộc bộ 34; đơn vị kế thừa nếu mã thuộc bộ 63 |
| Vùng | vùng của tỉnh bộ 63; với mã bộ 34, vùng chung của mọi tỉnh gộp vào đơn vị đó, nếu chúng cùng một vùng; không có mã tỉnh, hoặc đơn vị nằm vắt hai vùng, thì lấy vùng ở cột `region` |
| Miền | miền chứa vùng tìm được như trên; không thì miền ở cột `region`, hoặc miền chứa vùng ở cột đó |

Mã tỉnh được xét trước cột `region`, để số của một vùng luôn gồm đủ số của các tỉnh trong nó.

Tip không xếp được ở cấp đang xem (ví dụ chỉ biết "Miền Nam" khi đang xem theo tỉnh) được đếm vào dòng "chưa xếp được", không bị bỏ qua. Bảng `admin_unit` chưa gán vùng cho đơn vị bộ 34 (cách chia vùng sau sáp nhập chưa có nguồn chính thức); bản đồ chỉ xếp một đơn vị bộ 34 vào vùng hay miền khi mọi tỉnh gộp vào nó đều thuộc vùng hay miền đó. Theo bảng hiện có, 27 trong 34 đơn vị nằm trọn trong một vùng, và cả 34 nằm trọn trong một miền.

Cấp mở đầu của một dataset: cấp mịn nhất xếp được ít nhất một nửa số mẫu Việt Nam; không cấp nào đạt thì lấy cấp xếp được nhiều mẫu nhất (bằng nhau thì lấy cấp mịn hơn). Cấp này tính trên mọi mẫu, không theo bộ lọc, và chỉ tính khi các cột địa bàn đã tải xong.

Bộ lọc theo địa bàn gồm một cấp và các mã địa bàn của cấp đó. Bấm thêm địa bàn cùng cấp thì thêm vào hoặc bỏ ra; bấm địa bàn ở cấp khác thì thay cả bộ lọc. Đổi cấp đang xem không xoá bộ lọc: chọn một miền rồi xem theo tỉnh thì số của từng tỉnh chỉ đếm mẫu thuộc miền đó, và đường bao của miền được vẽ nét đứt.

## Kiến trúc

- **SVG, không thêm thư viện.** Mỗi cấp có 3 tới 63 đa giác: ít phần tử, nên DOM là chỗ hợp lý (bấm, focus, tên cho trình đọc màn hình có sẵn). Kế hoạch ban đầu ghi MapLibre GL; lý do đổi ở ADR-007.
- **Hình học tính sẵn lúc phát triển** (`npm run build:map`), không tính trong trình duyệt. Bộ dựng đọc hai file đường biên trong `frontend/map-data/` và các file seed địa danh của backend, rồi ghi `frontend/src/map/vn-map.json`: mỗi địa bàn có mã, tên, mã cha, mã kế thừa và đường vẽ đã chiếu sẵn vào khung toạ độ của SVG.
- **Hai nguồn đường biên:** bộ 34 lấy từ HDX COD-AB (OCHA, nguồn Tổng cục Thống kê, CC BY-IGO); bộ 63 lấy từ geoBoundaries (public domain). Chi tiết ở `frontend/map-data/NGUON.md`.
- **6 vùng và 3 miền là kết quả gộp các tỉnh bộ 63** theo cột vùng của backend. Gộp bằng cách khử cạnh chung: đường biên giữa hai tỉnh kề nhau trong file nguồn trùng nhau từng đỉnh.
- **File hình học là asset có hash của frontend** (`/assets/…`), chỉ tải khi bảng bản đồ mở và cây đã về; không nằm trong bundle chính, không có request ra ngoài (CSP của nginx chỉ cho cùng origin).
- **Bản đồ chỉ vẽ khi đã có cả hình học lẫn các cột địa bàn** (`unit`, `region`, `country`). Thiếu một cột thì mọi con số đều sai, nên nó chờ; cột tải không được thì báo và cho thử lại.
- **Đếm mẫu là một vòng lặp trên mảng mã của hai cột**, chạy lại khi bộ lọc đổi; không tạo object cho từng tip.
- Phép chiếu: kinh độ, vĩ độ tỉ lệ đều, kinh độ nhân cos của vĩ độ giữa (16°B). Ở phạm vi Việt Nam sai lệch hình dạng không đáng kể với một sơ đồ.

## Thay đổi so với bản nháp

- **Bộ lọc theo địa bàn là một bộ lọc riêng, không phải bộ lọc của cột `unit` hay `region`.** Bản nháp định biểu diễn việc chọn một miền bằng danh sách mã trong cột `region`. Cách đó không chọn được mẫu mang mã bộ 34 (cột `region` của chúng để trống), và hai cột lọc độc lập không diễn đạt được "tỉnh thuộc miền này, hoặc cột vùng ghi miền này". Bộ lọc mới định nghĩa thẳng bằng quy tắc xếp mẫu, nên số trên bản đồ và số mẫu cây giữ lại luôn khớp.
- **Mẫu mang mã bộ 34 được xếp vào vùng và miền khi suy ra được chắc chắn** (bản nháp để chúng ngoài hai cấp này). Mẫu nộp mới sẽ mang mã bộ 34, nên không làm vậy thì chúng biến mất ở cấp miền.
- **Đảo của Hoàng Sa và Trường Sa vẽ thành chấm**, cùng một bộ chấm ở cả bốn lớp, lấy từ nguồn chi tiết hơn (HDX).
- **Địa bàn không có mẫu không nằm trong thứ tự Tab** và không bấm được: không có gì để lọc. Rê chuột vẫn hiện tên của nó.
- **Một cột bên phải cho cả bản đồ và chi tiết mẫu:** chi tiết của mẫu đang chọn nằm trên, bản đồ nằm dưới.

## Giới hạn phải nói rõ trên giao diện và trong báo cáo

- Đường biên là sơ đồ, không phải bản đồ đo đạc; không dùng để xác định địa giới.
- Tô màu theo **số mẫu**, không chia cho dân số hay số ca bệnh: màu đậm nghĩa là nhiều trình tự được nộp, không phải nhiều ca bệnh.
- Vùng của mẫu chỉ khai tới miền không được suy đoán.

## Tiêu chí nghiệm thu

| # | Tiêu chí | Ngưỡng | Cách đo |
|---|---|---|---|
| B1 | Đủ địa bàn ở mỗi cấp | 3 miền, 6 vùng, 63 tỉnh, 34 đơn vị; mã khớp bảng `admin_unit` | Test đơn vị trên file hình học; test Playwright đếm phần tử |
| B2 | Số mẫu khớp file publish | Với mỗi cấp: số của từng địa bàn và số "chưa xếp được" khớp số tính lại từ `col.unit.json`, `col.region.json`, `col.country.json` | Test Playwright trên build DENV1 |
| B3 | Bản đồ là bộ lọc dùng chung | Bấm một địa bàn: số mẫu đang hiện, số tip cây vẽ và chú giải cùng đổi, khớp số của địa bàn; lọc theo chú giải thì số trên bản đồ đổi theo | Test Playwright |
| B4 | Chuyển giữa bộ 63 và bộ 34 | Mẫu của tỉnh cũ được cộng vào đơn vị kế thừa; tổng không đổi | Test đơn vị với dữ liệu dựng tay; test Playwright so tổng |
| B5 | Hình học đúng | Diện tích mỗi vùng, mỗi miền bằng tổng diện tích các tỉnh thành phần, mọi vòng khép kín; hình trên lưới của khung vẽ lệch diện tích hình nguồn dưới 2%; diện tích mỗi đơn vị bộ 34 (HDX) lệch dưới 20% so với các tỉnh bộ 63 gộp vào nó (geoBoundaries) | Test đơn vị |
| B6 | Hoàng Sa và Trường Sa có mặt | Thuộc đa giác của Đà Nẵng và Khánh Hòa; có nhãn | Test đơn vị trên file hình học; test Playwright |
| B7 | Không làm chậm cây | Bundle chính không chứa hình học; khung hình đầu của cây không đổi quá sai số đo | Kích thước build; harness `do_viewer.mjs` |
| B8 | Dùng được bằng bàn phím | Mỗi địa bàn focus được, có tên và số mẫu; Enter hoặc phím cách bật, tắt bộ lọc | Test Playwright |

## Các lát cắt dự kiến

1. Script dựng file hình học: đọc nguồn, khớp tên với mã, gộp, chiếu, ghi file; test cho B1, B5, B6.
2. Đếm mẫu theo cấp (thuần, không giao diện); test cho quy tắc xếp và B4.
3. Bảng bản đồ: vẽ, thang màu, chú giải, dòng tóm tắt; chọn cấp.
4. Rê chuột, focus, bấm để lọc; danh sách địa bàn.
5. Test đầu-cuối cho B2, B3, B8; đo B7; ảnh chụp.

## Đã được đồng ý (2026-10-13)

- **Nguồn đường biên:** HDX COD-AB cho bộ 34 và geoBoundaries cho bộ 63 (phương án "HDX + geoBoundaries"). Cả hai có Hoàng Sa trong Đà Nẵng và Trường Sa trong Khánh Hòa.
- Không cài gói npm hay thư viện Python nào.

## Câu hỏi mở

1. Mã tỉnh của Tổng cục Thống kê cho 34 đơn vị nay có trong file hình học (lấy từ HDX), nhưng chưa có trong bảng `admin_unit`; bản đồ vẫn dùng mã nội bộ. Có cần đưa vào DB ở mốc này không? Đề xuất: không, ghi là việc để sau.
2. Vùng của 34 đơn vị mới chưa có nguồn chính thức. Đề xuất: giữ sáu vùng cũ cho dữ liệu trước sáp nhập, không gán vùng cho mã bộ 34.
