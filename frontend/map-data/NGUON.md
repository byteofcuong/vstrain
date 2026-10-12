# Nguồn của dữ liệu đường biên

Hai file trong thư mục này là đầu vào của `npm run build:map`, lệnh dựng file hình học của bản đồ (`src/map/vn-map.json`). Tên, mã, vùng và đơn vị kế thừa của từng tỉnh không lấy từ đây mà từ các file seed của backend (`backend/app/geo/data/`).

Cả hai được tải ngày 2026-10-13, sau khi người làm đồ án đồng ý về nguồn và giấy phép.

## `hdx-vnm-adm1-snapped.geojson`: 34 đơn vị cấp tỉnh hiện hành

- **Nguồn:** *Viet Nam - Subnational Administrative Boundaries* (COD-AB), phiên bản 02, cấp hành chính 1. OCHA công bố trên Humanitarian Data Exchange; nguồn dữ liệu ghi là Tổng cục Thống kê (GSO); đường biên theo Quyết định 19/2025/QĐ-TTg, có hiệu lực từ 1/7/2025.
- **Trang:** <https://data.humdata.org/dataset/cod-ab-vnm>
- **Giấy phép:** Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO). Được dùng lại và sửa đổi, phải ghi nguồn và nói rõ đã sửa gì.
- **File gốc:** `vnm_admin1.geojson` trong `vnm_admin_boundaries.geojson.zip` (file zip 28.415.237 byte, SHA-256 `0a74e8ee18eb84b21f980fa4bd2a3135d2bc42fbd6e31450472368ff48abe41b`; file GeoJSON 48.313.077 byte, SHA-256 `d606ad96b97bf1686709738b4ab7b228442f8e5666e05c7c0e9693329ab44fad`). File gốc có 1.312.215 đỉnh, không lưu trong repo.
- **Đã sửa gì:** `scripts/snap-hdx.mjs` ghim mọi đỉnh vào lưới 0,01 độ (khoảng 1,1 km) và bỏ các đỉnh thừa, còn 20.532 đỉnh. Đa giác xẹp mất trên lưới đó bị bỏ; riêng đa giác thuộc quần đảo Hoàng Sa và Trường Sa được giữ lại vị trí trong thuộc tính `islets`. Thuộc tính của mỗi đơn vị rút còn mã, tên, loại và diện tích.
- **Dựng lại:** tải file zip từ trang trên, giải nén `vnm_admin1.geojson`, rồi chạy `node scripts/snap-hdx.mjs <đường dẫn tới file>` trong `frontend/`.
- **Mã tỉnh:** thuộc tính `pcode` là "VN" cộng mã tỉnh của Tổng cục Thống kê (Hà Nội `VN01`, Thành phố Hồ Chí Minh `VN79`).

## `geoBoundaries-VNM-ADM1_simplified.geojson`: 63 tỉnh trước 1/7/2025

- **Nguồn:** geoBoundaries (William & Mary geoLab), bộ gbOpen, Việt Nam, cấp ADM1, bản đã đơn giản hoá; mã bản `VNM-ADM1-63759600`, năm thể hiện 2008. Metadata ghi nguồn gốc là "geoBoundaries, Wikipedia".
- **Trang:** <https://www.geoboundaries.org/api/current/gbOpen/VNM/ADM1/>; file lấy ở commit `9469f09` của <https://github.com/wmgeolab/geoBoundaries>.
- **Giấy phép:** metadata của geoBoundaries ghi "Public Domain" (hình lấy từ Wikimedia Commons).
- **File:** giữ nguyên như tải về, 536.751 byte, SHA-256 `010bff8d3244064bc8001033ba79acc1215a1fb6e568f6f8a90da7ecec2c2fc5`.
- File có 64 hình: 63 tỉnh và Côn Đảo (một huyện của Bà Rịa - Vũng Tàu, được vẽ thành hình riêng). Bộ dựng nhập Côn Đảo vào Bà Rịa - Vũng Tàu.

## Mỗi nguồn dùng cho việc gì

| Lớp của bản đồ | Hình lấy từ | Cách làm |
|---|---|---|
| 34 đơn vị | HDX | giữ nguyên từng đơn vị |
| 63 tỉnh | geoBoundaries | giữ nguyên từng tỉnh |
| 6 vùng, 3 miền | geoBoundaries | gộp các tỉnh bộ 63 theo cột `region` của `provinces_vn63.tsv` |
| Chấm của Hoàng Sa, Trường Sa (mọi lớp) | HDX | mỗi đảo một chấm ở tâm của nó |

Các chấm của hai quần đảo lấy từ HDX ở cả bốn lớp vì file geoBoundaries chỉ có 8 hình ở Hoàng Sa và 9 hình ở Trường Sa, còn HDX có 18 và gần 300. Quần đảo thuộc địa bàn nào là do chính file nguồn của lớp đó quyết định: Hoàng Sa thuộc Đà Nẵng, Trường Sa thuộc Khánh Hòa ở cả hai nguồn.

## Đã kiểm tra

- **Tên và mã:** 63 hình của geoBoundaries và 34 hình của HDX khớp đủ, không thừa không thiếu, với các đơn vị trong bảng `admin_unit` (test `vn-map.test.ts`).
- **Bảng gộp 63 → 34:** với mỗi đơn vị bộ 34, diện tích hình của nó trong file HDX được so với tổng diện tích các tỉnh bộ 63 gộp vào nó trong file geoBoundaries. Hai nguồn độc lập cho kết quả lệch nhau dưới 5% ở 26 đơn vị và dưới 10% ở 33 đơn vị; đơn vị còn lại là Hải Phòng (15%), nơi hình của geoBoundaries rộng hơn hình của HDX. Test đặt ngưỡng 20%.
- **Gộp vùng và miền:** diện tích hình gộp bằng đúng tổng diện tích các tỉnh thành phần.

## Điều cần biết khi dùng

- **Là sơ đồ, không phải bản đồ đo đạc.** Hình của geoBoundaries thô và thể hiện địa giới năm 2008; hình của HDX đã bị làm tròn tới khoảng 1 km. Không dùng để xác định địa giới.
- **Thuộc tính `area_sqkm` của file HDX không phải lúc nào cũng khớp với hình:** Cà Mau ghi 6.310 km² trong khi hình của chính nó rộng khoảng 7.600 km² (Cà Mau và Bạc Liêu cũ cộng lại là 7.942 km²). Bộ dựng không dùng thuộc tính này.
- **Ở Trường Sa, file HDX có cả hình của bãi ngầm và rạn san hô**, nên diện tích hình của Khánh Hòa lớn hơn diện tích đất liền của tỉnh.
