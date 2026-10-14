import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

/**
 * Kiểm tra bản triển khai sau HTTPS (`e2e/https.spec.ts`). Trước khi chạy: `npm run build`, tạo chứng chỉ bằng
 * `sh deploy/make-dev-cert.sh`, rồi `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.https.yml
 * up -d` (từ thư mục gốc của repo). Khi bật HTTPS, cổng 8080 chỉ còn chuyển hướng, nên `e2e:web` không chạy được
 * cho tới khi stack được bật lại không kèm file đó.
 */
export default defineConfig({
  ...base,
  projects: [{ name: "https", testMatch: "https.spec.ts" }],
  use: { ...base.use, baseURL: "https://127.0.0.1:8443", ignoreHTTPSErrors: true },
  webServer: undefined,
});
