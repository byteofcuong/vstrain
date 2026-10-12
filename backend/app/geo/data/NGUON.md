# Nguồn của dữ liệu địa danh

Ba file TSV trong thư mục này là dữ liệu khởi tạo cho bảng `admin_unit` và `place_alias` (lệnh `python -m app.cli seed-geo`).

## `provinces_vn63.tsv`

63 đơn vị cấp tỉnh ngay trước ngày 1/7/2025, mỗi dòng có vùng, đơn vị kế thừa trong bộ 34 và các cách viết khác.

- **Cột `successor` (63 → 34):** theo Điều 1 Nghị quyết 202/2025/QH15 ngày 12/6/2025 của Quốc hội; chính quyền của các đơn vị mới hoạt động từ 1/7/2025.
  - Bảng ban đầu lấy từ nguồn thứ cấp (Vietnam Briefing, đọc ngày 2026-10-12).
  - Ngày 2026-10-12 đã đối chiếu từng dòng với toàn văn nghị quyết đăng trên Báo Đại biểu Nhân dân (<https://daibieunhandan.vn/nghi-quyet-ve-viec-sap-xep-don-vi-hanh-chinh-cap-tinh-10375832.html>): 23 khoản sáp nhập và 11 đơn vị không sắp xếp đều khớp, không dòng nào lệch.
  - Giới hạn: trang được đọc qua công cụ tóm tắt tự động, không phải đọc nguyên văn bằng mắt. Trước khi trích vào đồ án nên mở văn bản gốc (<https://vbpl.vn/TW/Lists/vbpq/Attachments/179501/202_2025_QH15_648951.doc>) kiểm lại một lần.
- **Cột `region`:** sáu vùng kinh tế - xã hội dùng trong Niên giám thống kê trước năm 2025 (11, 14, 14, 5, 6 và 13 tỉnh). Danh sách được liệt kê thủ công từ kiến thức chung, **chưa đối chiếu** với một văn bản của Tổng cục Thống kê.
- **Cột `variants`:** các cách viết thường gặp, liệt kê thủ công, không phải danh mục chính thức.
- Tên dùng cho bộ 63 là tên ngay trước sáp nhập: "Huế" (thành phố trực thuộc trung ương từ 1/1/2025), "Thừa Thiên Huế" là cách viết khác.

## `regions.tsv`

Ba miền (Bắc, Trung, Nam) và sáu vùng kinh tế - xã hội nói trên. Miền là cách chia quy ước: Bắc gồm hai vùng phía bắc, Trung gồm Bắc Trung Bộ và Duyên hải miền Trung cùng Tây Nguyên, Nam gồm Đông Nam Bộ và Đồng bằng sông Cửu Long. Cột `aliases` được liệt kê thủ công, ưu tiên các giá trị có thật trong GenBank ("South", "Red River Delta", "Mekong Delta", "Southeast Region").

**Chưa có:** vùng của 34 đơn vị mới. Sau sáp nhập, cách chia sáu vùng đã thay đổi (Bắc Trung Bộ tách riêng; Duyên hải Nam Trung Bộ gộp với Tây Nguyên), và chưa có nguồn chính thức cho danh sách đầy đủ. Vì vậy đơn vị bộ 34 chưa được gán vùng.

## `city_aliases.tsv`

Tên thành phố, thị xã thuộc tỉnh (chủ yếu là tỉnh lỵ) trỏ về tỉnh của bộ 63. Liệt kê thủ công; "Nha Trang" là giá trị có thật trong GenBank (562 bản ghi dengue).

## Chưa có trong dữ liệu

- Mã đơn vị hành chính chính thức (danh mục của Tổng cục Thống kê). Mã trong hệ thống (`vn63:dak-lak`) là mã nội bộ.
- Đường biên và toạ độ tâm của từng đơn vị.
