# Spec: module `viewer` (mốc M3)

Trạng thái: **đã triển khai** (2026-10-13; sáu tiêu chí nghiệm thu đều đạt, số đo ở mục "Checkpoint E" của `tasks/todo.md`). Các câu hỏi mở dùng phương án đề xuất, ghi ở cuối `tasks/todo.md`. Những chỗ triển khai khác bản nháp được ghi ở mục "Thay đổi so với bản nháp".

## Objective

Người xem mở được một dataset trên trình duyệt và làm được những việc cốt lõi của Auspice: xem cây theo thời gian hoặc theo độ phân kỳ, tô màu, lọc, rê chuột xem thông tin, bấm vào một mẫu để xem chi tiết. Khác Auspice ở chỗ cây 35 nghìn tip vẫn phản hồi tức thì.

Vấn đề đã đo ở Auspice (báo cáo đo đạc, mục F1–F3, F9): mỗi tip là 3,55 phần tử SVG; ở 35 nghìn tip, lọc theo ngày chặn main thread 1,97 giây, đổi màu 2,88 giây; trên khoảng 125 nghìn node thì không mở được.

## Phạm vi

Có:
- Trang danh sách dataset (từ `GET /api/datasets`).
- Trang dataset: cây vẽ bằng Canvas, hai kiểu bố cục (chữ nhật, toả tròn), hai trục (thời gian, độ phân kỳ).
- Tô màu theo một cột của manifest; chú giải bấm được để lọc.
- Lọc theo khoảng ngày và theo giá trị của cột; tìm mẫu theo tên hoặc accession.
- Rê chuột hiện tooltip; bấm vào tip mở bảng chi tiết (gọi `GET /api/samples/{internalId}`).
- Phóng to vào một nhánh, quay lại.
- Giao diện tiếng Việt và tiếng Anh; mọi chuỗi hiển thị đi qua một lớp dịch.

Không (để sau hoặc không làm): bản đồ (module `map`), panel entropy, animation theo thời gian, nhãn nhánh, narrative, so sánh hai cây, giao diện cho điện thoại.

## Hợp đồng dữ liệu (đã có ở backend)

- `GET /api/datasets` → mỗi dataset có `currentBuild.manifestUrl`.
- `manifest.json` (định dạng 1): `counts`, `files.tree`, `files.tips`, `columns[]` (mỗi cột: `key`, `scope` là `tip` hoặc `node`, `title.vi`, `title.en`, `valueCount`, `file.path`).
- `tree.json`: các mảng song song theo thứ tự duyệt trước: `name`, `parent` (cha luôn đứng trước con), `div`, `numDate`, `numDateLower`, `numDateUpper`, `tipNode`.
- `numDate` là một thời điểm ghi bằng năm thập phân, không phải một ngày: TreeTime đặt tip vào giữa ngày lấy mẫu, và `augur export` làm tròn 3 chữ số (lệch tới 0,18 ngày). Ngày lịch của một tip là ngày chứa thời điểm đó.
- `tips.json`: `displayName`, `accession`, `collectionDate` theo thứ tự tip.
- `col.<key>.json`: `values`, `codes` (−1 là thiếu), có thể có `labels`.
- Mọi file trong thư mục publish không bao giờ đổi (cache vĩnh viễn).

## Kiến trúc

- **React 19 + TypeScript + Vite**; trạng thái giao diện (màu, bộ lọc, bố cục, ngôn ngữ) trong **Zustand**.
- **Dữ liệu cây nằm ngoài React**: typed array (`Int32Array`, `Float32Array`) trong một module riêng; React chỉ giữ một số phiên bản để biết khi nào vẽ lại. Bài học từ Auspice: đưa cả cây vào Redux thì mỗi thao tác phải đi qua toàn bộ cây.
- **Web Worker** tải và parse JSON, tính bố cục, trả typed array về main thread bằng transfer (không sao chép).
- **Canvas 2D** vẽ nhánh và tip; khi nhiều tip rơi vào cùng một pixel thì chỉ vẽ một (phát triển từ prototype B, `do-dac/prototype/B-canvas/`).
- **Tìm tip dưới con trỏ** bằng lưới không gian dựng lại sau mỗi lần bố cục, không duyệt cả cây.
- **DOM chỉ cho thứ ít phần tử**: chú giải, tooltip, bảng chi tiết.

## Thay đổi so với bản nháp

- **Trục vẽ trên Canvas, không phải DOM.** Mốc của trục đổi theo từng khung hình khi phóng to; vẽ chung với cây thì không có lần render nào của React trong lúc phóng. Nhãn trục vì thế không đọc được bằng trình đọc màn hình; khoảng ngày của dataset có ở hai ô chọn ngày.
- **Phóng to không tính lại bố cục.** Vị trí node nằm trong hệ toạ độ [0, 1] × [0, 1]; phóng và kéo chỉ đổi phép biến đổi sang pixel. Lưới tìm tip cũng nằm trong hệ toạ độ này nên chỉ dựng lại khi đổi bố cục hoặc trục.
- **Tô màu tối đa tám giá trị.** Cột có nhiều hơn tám giá trị (quốc gia) thì tám giá trị nhiều mẫu nhất có màu riêng, phần còn lại chung một màu xám; bảng màu đã qua kiểm tra tách biệt cho người mù màu. Màu gắn với giá trị và không đổi khi lọc.
- **Bộ lọc ngày giữ hai ngày dạng chữ, tính cả hai ngày.** Việc đổi sang khoảng thời điểm trên cây nằm ở một hàm (`dayRange`), dùng cùng quy tắc với hàm gọi tên ngày của một tip, nên tip hiện ngày nào thì lọc đúng ngày đó sẽ giữ nó.
- **Tên node trong không được giữ ở trình duyệt**, chỉ giữ mã nội bộ của tip.
- **Không dùng thư viện router.** Hai trang phân biệt bằng phần `#` của URL.
- **Cửa nhìn cho test:** `window.__vietstrain` (chỉ đọc: số khung hình, số tip đã vẽ, toạ độ của một tip) để test đầu-cuối và harness đo hiệu năng dùng.
- **Ngoài danh sách dependency đã nêu** có thêm `@types/react` và `@types/react-dom` (khai báo kiểu của hai gói đã được đồng ý, chỉ dùng lúc biên dịch).

## Tiêu chí nghiệm thu

| # | Tiêu chí | Ngưỡng | Cách đo |
|---|---|---|---|
| 3 | Dataset 35 nghìn tip: tới khung hình đầu | ≤ 1 giây | Harness Playwright (như `do_canvas.mjs`), Chromium headless, median 5 lần |
| 3b | Lọc theo ngày, đổi cột màu ở 35 nghìn tip | ≤ 100 ms main thread bận, không có long task trên 50 ms do mã của ứng dụng | Performance trace |
| 3c | Rê chuột và bấm vào tip cho đúng mẫu | Đúng với 100 tip chọn ngẫu nhiên | Test Playwright so với `tree.json` |
| V1 | Dataset 100 nghìn tip mở được | Có khung hình, không lỗi | Dataset tổng hợp |
| V2 | Dataset DENV1 thật hiển thị đúng | Số tip, khoảng ngày, màu theo cột khớp file publish (manifest, `tree.json`, file cột) | Test Playwright |
| V3 | Đổi ngôn ngữ không tải lại dữ liệu | Có | Test |

So sánh với Auspice phải nói rõ hai bên không ngang tính năng (phần "Không" ở trên).

## Các lát cắt dự kiến

1. Khung Vite, trang danh sách dataset, test đầu tiên.
2. Worker tải manifest và cây; vẽ cây chữ nhật theo thời gian; harness đo khung hình đầu.
3. Trục và phóng to, thu nhỏ, kéo.
4. Tô màu theo cột, chú giải.
5. Lọc theo ngày và theo cột; tìm mẫu.
6. Tooltip, bấm chọn, bảng chi tiết mẫu.
7. Bố cục toả tròn; trục độ phân kỳ.
8. Song ngữ; đo lại tiêu chí 3, 3b, 3c trên 35 nghìn và 100 nghìn tip.

## Dependency (đã được đồng ý ngày 2026-10-12, đã cài trong `frontend/`)

| Loại | Gói | Dùng cho |
|---|---|---|
| Chạy | `react`, `react-dom` (19) | Giao diện |
| Chạy | `zustand` | Trạng thái giao diện |
| Phát triển | `typescript`, `vite`, `@vitejs/plugin-react` | Build |
| Phát triển | `vitest` | Test logic (bố cục, bộ lọc) |
| Phát triển | `@playwright/test` | Test đầu-cuối và harness hiệu năng; Chromium của Playwright đã có sẵn từ giai đoạn đo đạc |
| Phát triển | `eslint`, `typescript-eslint`, `prettier` | Lint và format |

Node: Node 24 portable ở `D:\nextstrain\do-dac\tools\node24` (không đụng Node 22 của máy). `maplibre-gl` thuộc module `map`, sẽ hỏi riêng.

## Câu hỏi mở

1. Build frontend bằng Node portable trên máy hay trong container?
2. Có cần chạy được offline hoàn toàn (không font, không CDN ngoài) không? Mặc định đề xuất: có.
3. Định dạng cột đang là JSON. Nếu phép đo ở lát 2 cho thấy parse vẫn chiếm phần lớn thời gian tải, có chuyển sang nhị phân không? Đề xuất: quyết sau khi có số.
