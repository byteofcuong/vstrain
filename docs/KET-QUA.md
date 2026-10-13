# Kết quả đo

Tài liệu này trả lời một câu hỏi: năm vấn đề đã đo được ở Nextstrain có được xử lý trong ứng dụng này không. Mỗi tiêu chí dưới đây được đặt ngưỡng **trước khi viết mã** (mục Success Criteria của [`SPEC.md`](../SPEC.md)); ngưỡng không được sửa sau khi đo.

## Điều kiện đo

- Một máy Windows 11, Docker Desktop trên WSL 2 được cấp 8 nhân và 13 GB bộ nhớ. Cả số của Nextstrain lẫn số của ứng dụng đều đo trên máy này, với cùng phiên bản công cụ (Augur 34.1.4, Nextclade 3.24, IQ-TREE 3.0.1).
- Dữ liệu: 59.551 bản ghi dengue công khai từ GenBank, trong đó 4.305 của Việt Nam. Mọi phép đo trên cây dùng DENV1.
- Stack thật: trình duyệt hoặc script gọi qua nginx ở cổng 8080, PostgreSQL thật, công cụ sinh học thật. Không phép đo nào dùng mock.
- "Baseline" là số đo Nextstrain (Augur, Auspice, workflow dengue) ở giai đoạn đầu của đồ án.
- File số liệu của từng phép đo nằm ở [`docs/so-lieu/`](so-lieu/). Script đo nằm trong thư mục đo đạc của đồ án, ngoài repo này.

## Bảng tổng hợp

| # | Tiêu chí | Ngưỡng | Baseline (Nextstrain) | Kết quả trên ứng dụng | Đạt |
|---|---|---|---|---|---|
| 1 | Nộp một genome hợp lệ vào cây ≤ 5.000 tip, tip tạm hiện công khai | ≤ 30 giây | Dựng lại cả cây: 2.020 giây | 2,4 giây ở cây 4.949 tip; 1,1 giây ở cây 1.964 tip | có |
| 1b | Mẫu gắn tạm có hàng xóm gần nhất trùng với cây dựng lại | ≥ 85% | Prototype: 88–91% | 95 trong 100 mẫu | có |
| 2 | Build không chạy lại bước gióng hàng; thời gian từng bước được ghi; N = 2.000 không chậm hơn baseline | ≤ 771 giây | 771 giây, trong đó gióng 72 giây | 755, 770, 770 giây trên cùng tập mẫu; mỗi bước có thời gian và log trong database | có, sát ngưỡng |
| 3 | Cây 35 nghìn tip: thời gian tới khung hình đầu | ≤ 1 giây | Auspice 4,44 giây | 0,47 giây (trung vị 5 lần, qua nginx) | có |
| 3b | Cây 35 nghìn tip: lọc hoặc đổi màu | ≤ 100 ms main thread bận | Auspice 1.971–2.879 ms | Nhiều nhất 40 ms; task dài nhất 26 ms | có |
| 3c | Rê chuột và bấm vào tip cho đúng mẫu | có | — | 100 tip ngẫu nhiên đều đúng | có |
| 4 | 4.305 bản ghi dengue Việt Nam: gán được tỉnh | ≥ 781 | 88 (2,0%) | 782 (18,2%) | có |
| 4b | Gán được tỉnh hoặc vùng | 2.306, tức mọi giá trị không trống | không có cấp vùng | 2.306 (53,6%); 0 giá trị chưa khớp | có |
| 4c | 331 cách viết của 63 tỉnh ra đúng tỉnh | ≥ 95% | Augur đúng 245 (74%) | 320 (96,7%) chỉ nhờ chuẩn hoá; 331 khi có bảng tên thay thế | có |
| 5 | Mẫu tên `Hà_Nội/01/2024` đi trọn luồng nộp và dựng cây | qua | `augur tree` thoát mã 2 | qua, kể cả khi tên là `Hà_Nội/01/2024; touch pwned` | có |
| 5b | Chuỗi tấn công trong tham số không được thực thi | không tạo file, job bị từ chối | `--tree-builder-args` thực thi lệnh | không file nào được tạo; công cụ ngoài danh sách bị từ chối trước khi chạy | có |

Hai tiêu chí của các mốc sau, đo thêm vì chúng trả lời cùng năm vấn đề:

| Tiêu chí | Baseline | Kết quả |
|---|---|---|
| Sửa một cách viết địa danh chưa khớp, tới lúc người xem thấy tỉnh mới trên cây | Sửa file TSV trong repo rồi chạy lại cả workflow (771 giây ở 2.000 chuỗi) | 0,64 giây; không job dựng cây nào được xếp, `tree.json` giữ nguyên hash |
| Mẫu nộp thành tip chính thức mà không ai gõ lệnh | Lịch nằm ngoài ứng dụng (GitHub Actions), chạy lại dù dữ liệu có đổi hay không | Worker tự xét mỗi phút, chỉ dựng khi tập mẫu đổi; một lần xét tốn 19–64 ms mỗi bộ dữ liệu |

## Điều ứng dụng không làm tốt hơn

**Dựng cây không nhanh hơn Nextstrain.** Gióng từng mẫu một lần lúc nhập bỏ được bước gióng hàng, là bước tăng nhanh hơn tuyến tính theo số mẫu. Nhưng `augur refine`, bước chiếm phần lớn thời gian và chạy một luồng, lại chậm hơn trên đầu vào của ứng dụng, và ăn hết phần tiết kiệm được.

| Bước (giây) | Nextstrain, 2.000 | Ứng dụng, 2.000 (cùng tập mẫu, 3 lần) | Nextstrain, 5.000 | Ứng dụng, 5.000 |
|---|---|---|---|---|
| Chọn mẫu và gióng | 77,0 | 0,1 – 0,3 | 322,9 | 1,1 |
| `tree` | 75,6 | 71,7 – 73,4 | 276,3 | 301,3 |
| `refine` | 573,5 | 648,6 – 659,7 | 1.316,4 | 1.598,4 |
| `ancestral`, `translate`, `clades`/`traits`, `export` | 44,5 | 35,1 – 38,5 | 104,7 | 87,3 |
| **Tổng** | **770,6** | **755,4 – 770,3** | **2.020,4** | **2.026,2** |

- Thời gian từng bước là số do tiến trình chạy công cụ tự đo; tổng là khoảng cách giữa lúc job bắt đầu và kết thúc theo đồng hồ của database. Ở 2.000 mẫu hai cách khớp nhau. Ở 5.000 mẫu, cộng các bước chỉ ra 1.989 giây: 37 giây chênh nằm gần hết trong bước `refine` (1.628 giây theo dấu thời gian của database, 1.598 giây theo tiến trình). Có thể hai đồng hồ của máy ảo lệch nhau trong một lần chạy dài; **chưa kiểm chứng**. Kết luận không đổi theo cách tính nào.
- Ở 2.000 mẫu hai bên chạy trên cùng 1.999 mẫu, nên so được. Ở 5.000 mẫu ứng dụng tự chọn mẫu theo quy tắc của nó (5.000 được chọn, 4.949 còn lại sau bộ lọc đồng hồ phân tử), nên đây là so cùng cỡ, không cùng tập mẫu.
- Một phép thử tách nguyên nhân ở 2.000 mẫu cho thấy trong khoảng 85 giây chênh của `refine`, nhiều nhất 32 giây là do môi trường chạy, ít nhất 54 giây là do đầu vào (alignment của Nextclade và cây dựng từ nó). Vì sao đầu vào này làm `refine` chậm hơn thì **chưa tìm hiểu**.
- Thứ giữ thời gian dựng cây trong tầm kiểm soát vì thế là trần số mẫu của mỗi bộ dữ liệu, và việc chỉ dựng lại khi tập mẫu đã đổi. Còn thứ làm người nộp không phải chờ là tip tạm, không phải build nhanh.

**Mẫu gắn tạm chỉ là tạm.** 5 trong 100 mẫu thử không rơi cạnh hàng xóm gần nhất của chúng trong cây dựng lại. Cả 5 là mẫu Việt Nam, nằm ở phần cây dày đặc mẫu rất giống nhau.

## Cách đo từng tiêu chí

### 1. Thời gian từ lúc nộp tới lúc tip tạm công khai

Script đăng nhập bằng một tài khoản tạm, gửi một genome GenBank không nằm trong cây qua `POST /api/submissions`, rồi hỏi `GET /api/datasets/<slug>/placements` tới khi mẫu có trong danh sách. Thời gian tính từ lúc gửi form. Mỗi lần một genome khác nhau, 20 lần.

| Cây | Trung vị | Nhanh nhất – chậm nhất |
|---|---|---|
| DENV1, 1.964 tip | 1,07 giây | 0,67 – 1,18 |
| DENV1, 4.949 tip | 2,40 giây | 1,85 – 2,78 |

- Ở lần đo thứ hai hệ thống có hai cây DENV1, và mỗi mẫu được gắn lên cả hai (0,4 giây cho cây nhỏ, 0,9 giây cho cây lớn), nên 2,4 giây là số của trường hợp nặng hơn.
- Khi worker dựng cây bị dừng hẳn, mẫu vẫn được xử lý bởi worker riêng cho mẫu nộp: trung vị 1,13 giây (5 lần, cây 1.964 tip).
- Giới hạn: đo trên máy cục bộ, một người nộp tại một thời điểm. Dữ liệu công khai không có genome Việt Nam nào đứng ngoài cây, nên genome thử là của nước khác.
- Số liệu: `thoi_gian_nop_2000.json`, `thoi_gian_nop_5000.json`.

### 1b. Mẫu gắn tạm có rơi đúng chỗ không

1. Lấy cây DENV1 đang phát (1.964 tip) làm "cây dựng lại đầy đủ". Bốc ngẫu nhiên 100 tip của nó, seed cố định: 74 mẫu Việt Nam, 26 mẫu bối cảnh.
2. Dựng một cây thiếu 100 mẫu đó bằng chính các bước dựng cây của ứng dụng (1.857 tip sau bộ lọc đồng hồ).
3. Gắn tạm từng mẫu lên cây thiếu bằng đúng hàm mà job nộp mẫu gọi.
4. Với mỗi mẫu, tìm tập mẫu cũ gần nó nhất dọc theo cành, trong cây đã gắn và trong cây đầy đủ. Hai tập giao nhau thì mẫu được tính là gắn đúng. Các mẫu cách nhau dưới nửa đột biến được coi là gần như nhau.

| | Gắn đúng |
|---|---|
| Cả 100 mẫu | 95 (95%) |
| 74 mẫu Việt Nam | 69 (93,2%) |
| 26 mẫu bối cảnh | 26 (100%) |

- Một lần gắn mất 0,46 giây (trung vị), chậm nhất 0,85 giây; cả 100 mẫu đều gắn được.
- **Trần của chỉ số:** dựng lại cây đầy đủ lần nữa với seed IQ-TREE khác, rồi so hai cây đầy đủ với nhau: 100 trong 100. Hai cây đó không giống hệt nhau (1.964 và 1.957 tip). Ở prototype trước đây trần là 94–97%; vì sao lần này cao hơn thì **chưa tìm hiểu**.
- Giới hạn: một lần bốc 100 mẫu, một serotype. Chỉ số chỉ xét hàng xóm gần nhất, không xét ngày suy luận hay vị trí của mẫu trên trục thời gian (tip tạm dùng ngày do người nộp khai).
- Số liệu: `gan_tam.json` (có kết quả của từng mẫu).

### 2. Thời gian build

Bảng ở mục trên. Mỗi bước của pipeline ghi thời gian, số liệu và đuôi log vào bảng `job_step`; trang việc nền của admin đọc từ đó.

- Số liệu: `build_tap_p1_lan1.json` tới `lan3.json` (cùng tập mẫu với baseline), `job_build_denv1_2000.json` và `job_build_denv1_5000.json` (tập mẫu do ứng dụng chọn), `nextstrain_p1_thoi_gian_tung_buoc.txt` (baseline, trung vị 3 lần mỗi bước).

### 3, 3b, 3c. Viewer

Chromium headless qua Playwright, cửa sổ 1920 × 1080, cache tắt, mỗi lần một context mới, 5 lần. Cây 35 nghìn tip (57.930 node) và 100 nghìn tip là đúng hai cây tổng hợp đã dùng để đo Auspice. Số "main thread bận" lấy từ trace của Chromium.

| | Auspice | Ứng dụng, đo ở mốc viewer | Ứng dụng, bản cuối (qua nginx) |
|---|---|---|---|
| Khung hình đầu, 35 nghìn tip | 4,44 giây | 0,31 giây | 0,47 giây (0,37 – 0,57) |
| Khung hình đầu, 100 nghìn tip | không mở được | 0,46 giây | không đo lại |
| Đổi cột màu, 35 nghìn tip: main thread bận | 2.491 ms (long task dài nhất) | 62 ms | 28 ms |
| Lọc theo ngày, 35 nghìn tip | 1.677 ms (long task dài nhất) | 24 ms | 20 ms (nhiều nhất 40) |
| Task dài nhất trong mọi thao tác đo được | — | 77 ms (lần đầu đổi sang bố cục toả tròn) | 45,5 ms |

- Số 0,31 giây đo trên máy chủ thử của Vite; số 0,47 giây đo qua nginx, có nén và có thêm bản đồ, phiên đăng nhập và tip tạm trong trang. Hai số không cùng điều kiện; số nên trích là 0,47 giây.
- Mỗi thao tác chỉ chạy một lần cho mỗi lần tải trang, nên đây là số của lần dùng đầu tiên. Việc ghi trace làm trình duyệt chậm đi; các số là cận trên.
- Từ khi có đăng nhập, console của trình duyệt ghi một dòng `401` mỗi lần khách mở trang: đó là câu trả lời của `GET /api/auth/me` cho người chưa đăng nhập, không phải lỗi JavaScript.
- Tiêu chí 3c là một test đầu-cuối: rê chuột và bấm vào 100 tip ngẫu nhiên của cây DENV1 thật, so tên hiện ra với file của bản publish (`frontend/e2e/viewer.spec.ts`).
- Số liệu: `viewer_35000_tip.json` (bản cuối), `viewer_100000_tip.json` (mốc viewer).

### 4, 4b, 4c. Địa danh

- 4 và 4b là kết quả của lệnh `python -m app.cli geo-report` trên database thật: 782 bản ghi ra tỉnh (562 là "Nha Trang", về Khánh Hòa), 1.524 chỉ ra tới vùng hoặc miền ("South" 1.455), 1.999 để trống ngay từ GenBank. Trần của cả hai tiêu chí do dữ liệu quyết định.
- 4c dùng 331 cách viết của 63 tỉnh (có dấu, không dấu, viết liền, chữ thường, kèm "Province", và 16 tên khác hẳn như "Saigon", "BRVT"). 11 cách viết mà chuẩn hoá không tự ra được đều thuộc nhóm tên khác hẳn; chúng cần một dòng trong bảng tên thay thế. Con số 331 trên 331 không nói lên nhiều, vì 16 tên đó cũng chính là dữ liệu đã nạp vào bảng; số nên trích là 96,7%.
- Số liệu: `dia_danh.json`, `dia_danh_331_cach_viet.json`.

### 5, 5b. Tên có dấu và chuỗi tấn công

Đây là các test trong bộ `pytest`, chạy với công cụ thật trong image worker (61 test của năm file liên quan đều qua; danh sách ở `test_an_toan.txt`):

- Tên hiển thị `Hà_Nội/01/2024; touch pwned` đi qua gióng hàng, dựng cây và publish. Mọi file đưa cho công cụ chỉ chứa mã nội bộ (`S000123`), ngày ở dạng chuẩn và chuỗi; tên có trong bản publish cuối cùng; không file `pwned` nào được tạo.
- Đối số tới công cụ đúng nguyên văn, không shell nào diễn giải. Công cụ ngoài danh sách cho phép (`touch`, `sh`, đường dẫn tới `python3`) bị từ chối trước khi bất cứ thứ gì chạy.
- Một mẫu nộp qua form với tên có dấu thành tip tạm, rồi thành tip chính thức ở lần dựng cây do lịch xếp (`tests/test_ingest.py`, `frontend/e2e/submission.spec.ts`).

### Sửa địa danh và lịch dựng cây

- Một mẫu GenBank đang nằm trong cây DENV1 được tạm đổi địa danh gốc thành một cách viết lạ. Admin gọi API gán cách viết đó cho một tỉnh; phép đo tính từ lời gọi tới lúc `GET /api/datasets` phát một bản publish khác. 3 lần: lời gọi API 83 ms (trung vị), bản publish mới sau 0,64 giây (0,60 – 0,92). Sau phép đo, mẫu và bản publish quay về đúng như cũ.
- So với 682 giây của lần dựng cây gần nhất, đây là so bậc độ lớn, không phải hai lần chạy cùng điều kiện.
- Dữ liệu thật hiện không có địa danh Việt Nam nào chưa khớp, nên cách viết lạ phải được tạo ra cho phép đo.
- Lịch chưa được để chạy qua nhiều ngày trên dữ liệu thật; bằng chứng là test với đồng hồ được truyền vào và một lần chạy vòng lặp của worker với công cụ thật.
- Số liệu: `sua_dia_danh_tron_luong.json`, `xet_lich.json`.

## Kiểm thử

Bản cuối: 599 test backend trong image api (17 test cần công cụ sinh học tự bỏ qua ở đó), 616 test trong image worker với công cụ thật, 277 test logic của frontend, 46 test đầu-cuối và 52 khi đi qua nginx. Ba module rủi ro nhất (đăng nhập, nộp mẫu, vận hành) còn qua mutation check: mã bị sửa sai có chủ đích ở từng chỗ một để xem bộ test có bắt được không; mọi chỗ sửa thử đều bị bắt sau khi bổ sung test.

## Chưa đo

- Nhiều người dùng cùng lúc, mạng chậm, máy khác.
- Ba serotype còn lại, và mầm bệnh khác dengue.
- Bộ nhớ và thời gian của viewer trên điện thoại.
- Chất lượng khoa học của cây: cách chọn mẫu bối cảnh là một quy tắc đơn giản.
