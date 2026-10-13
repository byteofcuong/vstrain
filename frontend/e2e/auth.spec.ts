import { expect, test, type Page } from "@playwright/test";

import { createAccount, removeAccount, type Account } from "./accounts.mjs";

/**
 * Test đầu-cuối của đăng nhập, trên stack thật. Mỗi worker tạo một tài khoản tạm bằng lệnh quản trị và xoá nó
 * khi xong; mật khẩu là chuỗi ngẫu nhiên có dấu tiếng Việt.
 */
let account: Account;

test.beforeAll(() => {
  account = createAccount();
});

test.afterAll(() => {
  removeAccount(account.email);
});

async function logIn(page: Page, email = account.email, password = account.password): Promise<void> {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

const masthead = (page: Page) => page.locator(".masthead");

test("a guest finds the way to log in, and the page says who gets an account", async ({ page }) => {
  await page.goto("/");
  await masthead(page).getByRole("link", { name: "Đăng nhập" }).click();

  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
  await expect(page.getByText("Tài khoản do quản trị viên cấp.")).toBeVisible();
  // Đang ở trang đăng nhập thì thanh đầu trang không lặp lại đường dẫn tới chính nó.
  await expect(masthead(page).getByRole("link", { name: "Đăng nhập" })).toHaveCount(0);
});

test("a wrong password is refused without saying which part was wrong, and nobody is logged in", async ({ page }) => {
  // Tài khoản riêng cho test này: lần sai của nó không cộng vào tài khoản mà các test khác dùng để đăng nhập.
  const other = createAccount();
  try {
    await logIn(page, other.email, "sai mật khẩu rồi");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Email hoặc mật khẩu không đúng, hoặc tài khoản đang tạm khoá");
    const wrongPassword = await alert.textContent();
    // Mật khẩu vừa gõ bị xoá và con trỏ về lại ô đó; email được giữ.
    await expect(page.getByLabel("Mật khẩu")).toHaveValue("");
    await expect(page.getByLabel("Mật khẩu")).toBeFocused();
    await expect(page.getByLabel("Email")).toHaveValue(other.email);
    await expect(page).toHaveURL(/#\/login$/);
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);

    // Email không có tài khoản nhận đúng lời báo đó.
    await logIn(page, "khong-co-ai@example.org", other.password);
    await expect(alert).toHaveText(wrongPassword!);
  } finally {
    removeAccount(other.email);
  }
});

test("logging in shows who is logged in, lasts through a reload, and logging out ends it", async ({
  page,
  context,
}) => {
  await logIn(page);

  // Về trang danh sách, thanh đầu trang ghi tên người đang đăng nhập.
  await expect(page.getByRole("heading", { name: "Bộ dữ liệu" })).toBeVisible();
  await expect(masthead(page)).toContainText(account.displayName);
  await expect(masthead(page).getByRole("link", { name: "Đăng nhập" })).toHaveCount(0);

  // Phiên nằm trong một cookie mà JavaScript của trang không đọc được.
  const cookie = (await context.cookies()).find((one) => one.name === "vs_session");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("vs_session");

  await page.reload();
  await expect(masthead(page)).toContainText(account.displayName);

  await masthead(page).getByRole("button", { name: "Đăng xuất" }).click();
  await expect(masthead(page).getByRole("link", { name: "Đăng nhập" })).toBeVisible();
  await expect(masthead(page)).not.toContainText(account.displayName);
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  // Cookie cũ, nếu còn ai giữ, không còn dùng được ở server.
  const replay = await page.request.get("/api/auth/me", { headers: { Cookie: `vs_session=${cookie!.value}` } });
  expect(replay.status()).toBe(401);
});

test("a logout that does not reach the server leaves the name showing, since the session is still alive", async ({
  page,
}) => {
  await logIn(page);
  await expect(masthead(page)).toContainText(account.displayName);

  await page.route("**/api/auth/logout", (route) => route.abort());
  const refused = page.waitForEvent("requestfailed", (request) => request.url().endsWith("/api/auth/logout"));
  await masthead(page).getByRole("button", { name: "Đăng xuất" }).click();
  await refused;

  expect((await page.request.get("/api/auth/me")).status()).toBe(200);
  await expect(masthead(page)).toContainText(account.displayName);
  await expect(masthead(page).getByRole("link", { name: "Đăng nhập" })).toHaveCount(0);

  // Mạng trở lại thì bấm lần nữa là ra.
  await page.unroute("**/api/auth/logout");
  await masthead(page).getByRole("button", { name: "Đăng xuất" }).click();
  await expect(masthead(page).getByRole("link", { name: "Đăng nhập" })).toBeVisible();
});

test("the login form works from the keyboard alone", async ({ page }) => {
  await page.goto("/#/login");

  await page.getByLabel("Email").focus();
  await page.keyboard.type(account.email);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Mật khẩu")).toBeFocused();
  await page.keyboard.type(account.password);
  await page.keyboard.press("Enter");

  await expect(masthead(page)).toContainText(account.displayName);
});

test("someone already logged in who opens the login page is sent to the list", async ({ page }) => {
  await logIn(page);
  await expect(masthead(page)).toContainText(account.displayName);

  await page.goto("/#/login");

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { name: "Bộ dữ liệu" })).toBeVisible();
});

test("the login page speaks English when asked", async ({ page }) => {
  await page.goto("/#/login");
  await page.getByRole("button", { name: "English" }).click();

  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await page.getByLabel("Email").fill("nobody-here@example.org");
  await page.getByLabel("Password").fill("certainly not the password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText("Wrong email or password");
});

test("being logged in does not change what a guest could already see", async ({ page }) => {
  await logIn(page);
  await expect(masthead(page)).toContainText(account.displayName);

  await page.goto("/#/d/dengue-denv1");

  await expect(page.getByRole("img", { name: /Cây phát sinh loài/ })).toBeVisible();
  await expect(masthead(page)).toContainText(account.displayName);
});
