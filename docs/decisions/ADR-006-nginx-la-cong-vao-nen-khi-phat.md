# ADR-006: nginx là cổng vào duy nhất; frontend build trên máy; nén khi phát

## Status
Accepted

## Date
2026-10-13

## Context
Khi phát triển có hai server: Vite (frontend, cổng 5173 hoặc 4173) và uvicorn (API và file publish, cổng 8000). Bản triển khai cần một origin duy nhất, phát file tĩnh mà không qua Python, và đặt đúng header cache: thư mục publish của mỗi build mang hash nội dung trong tên (`p-<hash>`) nên không bao giờ đổi.

Phép đo S1–S2 cho thấy `auspice view` không gửi `ETag` hay `Cache-Control` cho dataset, và nén lại ở mỗi request (0,3 s brotli cho dataset 35 nghìn tip trên máy cục bộ).

Kế hoạch ban đầu ghi "nén sẵn brotli". Hai sự thật làm đổi lựa chọn đó:

- Image `nginx` chính thức (1.28) có `gzip` và `gzip_static` nhưng không có module brotli. Muốn có brotli phải tự build image.
- Số đo trên chính hệ thống này, nén gzip mức 6 ngay lúc phát (máy cục bộ, 3 lần mỗi ô):

| `tree.json` | Không nén | gzip | Thời gian không nén | Thời gian có nén |
|---|---|---|---|---|
| DENV1 thật, 1.964 tip | 199 KB | 54 KB | 9–11 ms | 20–38 ms |
| Tổng hợp, 35 nghìn tip | 3,48 MB | 784 KB | 30–55 ms | 183–223 ms |
| Tổng hợp, 100 nghìn tip | 10,05 MB | 2,24 MB | 77–188 ms | 541–556 ms |

Mỗi dataset của webapp có trần số mẫu (2.000 với DENV1), nên file thật nằm ở cỡ của dòng đầu.

## Decision
- Service `web` chạy image `nginx:1.28-alpine`, là cổng vào duy nhất của bản triển khai (`http://127.0.0.1:8080`): phát frontend đã build, phát thư mục publish, chuyển `/api/` sang service `api`. Mọi đường dẫn khác trả 404.
- Frontend được build trên máy bằng Node 24 portable (`npm run build`), thư mục `frontend/dist` được mount vào container. Không thêm image Node.
- File publish chỉ được phát theo đúng một dạng đường dẫn, `/builds/<slug>/b<mã build>/p-<12 chữ số hex>/<tên file>`, cùng biểu thức với kiểm tra ở API. File trung gian của build nằm ngoài `p-<hash>` không lọt ra ngoài.
- Header cache: `immutable`, một năm cho `/assets/` (tên file có hash của Vite) và `/builds/`; `no-cache` cho trang HTML; nginx không thêm gì vào phản hồi của API. Trang lỗi không mang header cache.
- Header bảo mật trên mọi phản hồi, kể cả trang lỗi: `Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Nén gzip ngay lúc phát cho JSON, JavaScript, CSS và HTML. Không nén sẵn.
- Đường `/builds/` của API vẫn giữ, để dev server của Vite dùng được mà không cần nginx.

## Alternatives Considered

### Nén sẵn lúc publish (`gzip_static`, hoặc brotli với image tự build)
- Ưu: không tốn CPU lúc phát; brotli nhỏ hơn gzip.
- Nhược: bước publish phải ghi thêm một bản nén cho mỗi file; brotli còn cần một image nginx tự build và tự bảo trì.
- Chưa làm: với dataset có trần 2.000 mẫu, nén lúc phát tốn khoảng 10–30 ms cho lần tải đầu của mỗi người dùng, sau đó trình duyệt giữ file vĩnh viễn. Nếu trần số mẫu được nâng lên cỡ chục nghìn (dòng hai và ba của bảng: 0,2–0,55 giây mỗi lần phát), đây là việc đầu tiên cần làm.

### Build frontend trong một image Node (multi-stage)
- Ưu: `docker compose up --build` là đủ, không cần Node trên máy.
- Nhược: thêm một image phải tải và một bước build chậm trong container; máy này đã có Node 24 portable dùng cho test.
- Loại ở giai đoạn này. Cái giá: phải nhớ chạy `npm run build` trước; quên thì trang trả 404.

### Để FastAPI phát cả frontend lẫn file publish
- Ưu: bớt một service.
- Nhược: mỗi file tĩnh đi qua Python; header và nén phải tự viết; khác với cách triển khai thật.
- Loại.

### SPA fallback (mọi đường dẫn lạ trả về `index.html`)
- Ứng dụng định tuyến bằng phần sau dấu `#`, nên chỉ có một trang. Trả 404 cho đường dẫn lạ làm lỗi gõ sai địa chỉ lộ ra ngay, và không biến mọi đường dẫn thành một trang 200.

## Consequences
- Một origin: cookie phiên đăng nhập (mốc M5) sẽ là same-origin, không cần CORS.
- Chính sách CSP chặn mọi script, style hay kết nối ra ngoài origin. Bản đồ (mốc M4) phải dùng dữ liệu tự host; nếu cần nguồn ngoài thì phải sửa chính sách này một cách có chủ ý.
- Bộ test đầu-cuối chạy được qua nginx (`npm run e2e:web`): 9 test của viewer cộng 5 test của chính cấu hình này. Sửa thử 15 chỗ trong `nginx.conf`, cả 15 đều bị test bắt.
- Chưa có HTTPS; cổng chỉ mở trên `127.0.0.1`. Đưa lên server cần thêm chứng chỉ và `Strict-Transport-Security`.
- Sửa `nginx.conf` xong phải nạp lại: `docker compose -f deploy/docker-compose.yml exec web nginx -s reload`.
