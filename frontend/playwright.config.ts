import { defineConfig } from "@playwright/test";

/** Test của việc nộp mẫu. Chúng thêm tip tạm vào dataset mà các test khác đang đọc, nên chạy riêng, sau cùng. */
export const SUBMISSION = "submission.spec.ts";
/** Test của các trang quản trị. Chúng xếp job và thêm dataset tạm, nên cũng chạy riêng. */
export const ADMIN = "admin.spec.ts";

/**
 * Ba nhóm test: `viewer` chạy song song và chỉ đọc; `submission` rồi `admin` chạy sau khi `viewer` xong, lần lượt
 * từng test, vì chúng ghi vào dữ liệu dùng chung (mỗi nhóm tự dọn những gì nó tạo ra).
 */
export function projects(viewerIgnore: string[]) {
  return [
    { name: "viewer", testIgnore: [...viewerIgnore, SUBMISSION, ADMIN] },
    { name: "submission", testMatch: SUBMISSION, dependencies: ["viewer"], fullyParallel: false },
    { name: "admin", testMatch: ADMIN, dependencies: ["submission"], fullyParallel: false },
  ];
}

/**
 * Test đầu-cuối chạy trên bản build của frontend (thứ sẽ được triển khai), không phải dev server: mỗi lần chạy
 * build lại rồi phục vụ ở cổng 4173. API và file publish do backend ở cổng 8000 phục vụ
 * (`docker compose -f deploy/docker-compose.yml up -d`). Dataset dùng để thử là build DENV1 thật.
 */
export default defineConfig({
  testDir: "e2e",
  // Các kiểm tra của nginx chỉ có nghĩa khi chạy qua service `web`: xem `playwright.web.config.ts`.
  projects: projects(["deploy.spec.ts"]),
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
