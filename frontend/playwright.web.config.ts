import { defineConfig } from "@playwright/test";

import base, { projects } from "./playwright.config";

/**
 * Cùng bộ test đầu-cuối, chạy qua service `web` (nginx) của bản triển khai ở cổng 8080 thay vì `vite preview`,
 * cộng thêm các kiểm tra riêng của nginx trong `e2e/deploy.spec.ts`. Trước khi chạy:
 * `npm run build` rồi `docker compose -f deploy/docker-compose.yml up -d` (từ thư mục gốc của repo).
 */
export default defineConfig({
  ...base,
  projects: projects([]),
  use: { ...base.use, baseURL: "http://127.0.0.1:8080" },
  webServer: undefined,
});
