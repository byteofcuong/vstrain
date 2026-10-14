import { expect, test } from "@playwright/test";

/**
 * Giới hạn số lần đăng nhập theo địa chỉ IP, đặt ở service `web` (nginx). Chỉ chạy với `npm run e2e:web`, sau mọi
 * test khác: test này dùng hết lượt đăng nhập của máy chạy test, và lượt chỉ hồi lại sau khoảng một phút.
 *
 * Trên Docker Desktop mọi request từ máy chủ tới nginx mang cùng một địa chỉ (cổng của mạng Docker), nên ở máy
 * phát triển giới hạn này là chung cho mọi người dùng.
 */
const BURST = 30;
const SENT = 50;

test("logins from one address beyond the limit are refused at the gateway, and the login page says why", async ({
  page,
  request,
}) => {
  // Thiếu header `X-Requested-With`: API từ chối ngay (403) mà không băm mật khẩu hay ghi nhật ký, nhưng nginx
  // vẫn tính đó là một lần đăng nhập.
  const responses = await Promise.all(
    Array.from({ length: SENT }, () =>
      request.post("/api/auth/login", { data: { email: "khong-co-ai@example.org", password: "khong quan trong" } }),
    ),
  );
  const statuses = responses.map((response) => response.status());
  const refused = responses.filter((response) => response.status() === 429);

  // Những request nginx cho qua tới API đều nhận lời từ chối của API, không phải lỗi khác.
  expect(statuses.filter((status) => status !== 429).every((status) => status === 403)).toBe(true);
  expect(statuses.filter((status) => status === 403).length).toBeLessThanOrEqual(BURST + 1);
  expect(refused.length).toBeGreaterThanOrEqual(SENT - BURST - 1);
  for (const response of refused) {
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toEqual({
      error: { code: "TOO_MANY_LOGINS", message: "Too many logins from this address; try again in a minute" },
    });
    // Lời từ chối của nginx vẫn mang header bảo mật như mọi trang khác.
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  }

  // Phần còn lại của trang không bị ảnh hưởng.
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.get("/api/auth/session")).status()).toBe(200);

  // Người dùng thấy lời báo riêng, không phải lời "lỗi máy chủ" chung.
  await page.goto("/#/login");
  await page.getByLabel("Email").fill("khong-co-ai@example.org");
  await page.getByLabel("Mật khẩu").fill("khong quan trong");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Có quá nhiều lần đăng nhập từ mạng của bạn trong thời gian ngắn. Thử lại sau một phút.",
  );
});
