import { expect, test } from "@playwright/test";

import { createAccount, removeAccount, type Account } from "./accounts.mjs";
import { SLUG } from "./support";

/**
 * Bản triển khai sau HTTPS. Chỉ chạy với `npm run e2e:https`, khi stack được bật kèm `deploy/docker-compose.https.yml`
 * (cổng 8443) và đã có chứng chỉ trong `deploy/certs/`. Chứng chỉ trên máy phát triển là chứng chỉ tự ký, nên
 * trình duyệt của test được dặn bỏ qua lỗi chứng chỉ; mọi thứ khác là thật.
 */
const HTTP = "http://127.0.0.1:8080";
const HTTPS = "https://127.0.0.1:8443";

let account: Account;

test.beforeAll(() => {
  account = createAccount();
});

test.afterAll(() => {
  removeAccount(account.email);
});

test("the plain address sends every path to the same path over HTTPS", async ({ request }) => {
  for (const path of ["/", "/api/health", `/api/datasets/${SLUG}`]) {
    const response = await request.get(`${HTTP}${path}`, { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers()["location"]).toBe(`${HTTPS}${path}`);
  }
  // Một lần đăng nhập gửi nhầm qua HTTP không tới API: mật khẩu chưa rời máy dưới dạng chữ rõ thêm lần nào nữa.
  const login = await request.post(`${HTTP}/api/auth/login`, {
    maxRedirects: 0,
    data: { email: account.email, password: account.password },
    headers: { "X-Requested-With": "vietstrain" },
  });
  expect(login.status()).toBe(301);
});

test("over HTTPS the page keeps its security headers and tells the browser to stay on HTTPS", async ({ request }) => {
  const response = await request.get(`${HTTPS}/`);

  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-security-policy"]).toBe(
    "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["cache-control"]).toBe("no-cache");
  // Máy phát triển: max-age=0 để trình duyệt không nhớ HTTPS cho `localhost` (HSTS áp cho mọi cổng của tên đó).
  expect(headers["strict-transport-security"]).toBe("max-age=0");
  expect((await request.get(`${HTTPS}/api/health`)).headers()["strict-transport-security"]).toBe("max-age=0");
});

test("a person logs in over HTTPS, the session cookie only travels over HTTPS, and the tree opens", async ({
  page,
}) => {
  await page.goto(`${HTTPS}/#/login`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Mật khẩu").fill(account.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.locator(".masthead")).toContainText(account.displayName);

  const session = (await page.context().cookies(HTTPS)).find((cookie) => cookie.name === "vs_session");
  expect(session).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax" });

  await page.goto(`${HTTPS}/#/d/${SLUG}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator(".masthead")).toContainText(account.displayName);
});
