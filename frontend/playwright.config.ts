import { defineConfig } from "@playwright/test";

/**
 * Test đầu-cuối chạy trên bản build của frontend (thứ sẽ được triển khai), không phải dev server: mỗi lần chạy
 * build lại rồi phục vụ ở cổng 4173. API và file publish do backend ở cổng 8000 phục vụ
 * (`docker compose -f deploy/docker-compose.yml up -d`). Dataset dùng để thử là build DENV1 thật.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://127.0.0.1:4173",
    // Không dùng lại server đang chạy sẵn: nó có thể đang phục vụ một bản build cũ.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
