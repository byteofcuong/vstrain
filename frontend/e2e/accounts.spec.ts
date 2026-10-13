import { expect, test, type Browser, type Page } from "@playwright/test";

import { createAccount, removeAccount, temporaryEmail, temporaryPassword, type Account } from "./accounts.mjs";

/**
 * Quản lý tài khoản trên stack thật: admin tạo một tài khoản trên giao diện, người mới đăng nhập và tự đổi mật khẩu,
 * admin khoá, mở khoá và đặt lại mật khẩu. Các test chạy lần lượt trên cùng một tài khoản; nó được xoá khi xong.
 */
test.describe.configure({ mode: "serial" });

// Cùng dạng với email của `createAccount`, để `removeAccount` nhận nó là một tài khoản tạm.
const EMAIL = temporaryEmail();
const NAME = "Phòng xét nghiệm thử";
const INITIAL = temporaryPassword("mật khẩu ban đầu");
const OWN = temporaryPassword("mật khẩu tự đặt");
const RESET = temporaryPassword("mật khẩu đặt lại");
let admin: Account;

test.beforeAll(() => {
  admin = createAccount("admin");
});

test.afterAll(() => {
  removeAccount(EMAIL);
  removeAccount(admin.email);
});

const masthead = (page: Page) => page.locator(".masthead");

async function attempt(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

async function logIn(page: Page, email: string, password: string, name: string): Promise<void> {
  await attempt(page, email, password);
  await expect(masthead(page)).toContainText(name);
}

/** Một trình duyệt khác: đăng nhập được thì trả về trang đang mở, để xem phiên đó về sau còn sống không. */
async function elsewhere(browser: Browser, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await logIn(page, EMAIL, password, NAME);
  return page;
}

async function expectLoggedOut(page: Page): Promise<void> {
  await page.reload();
  await expect(masthead(page).getByRole("link", { name: "Đăng nhập" })).toBeVisible();
  await expect(masthead(page)).not.toContainText(NAME);
}

async function expectRefused(browser: Browser, password: string): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await attempt(page, EMAIL, password);
  await expect(page.getByRole("alert")).toContainText("Email hoặc mật khẩu không đúng");
  await context.close();
}

const accountRow = (page: Page, email: string) => page.getByRole("row", { name: new RegExp(email) });

test("an administrator creates an account on the accounts page", async ({ page }) => {
  await logIn(page, admin.email, admin.password, admin.displayName);
  await page.getByRole("link", { name: "Quản trị" }).click();
  await page.getByRole("navigation", { name: "Quản trị" }).getByRole("link", { name: "Tài khoản" }).click();
  await expect(page).toHaveURL(/#\/admin\/users$/);

  // Dòng của chính mình: không có nút khoá, và mật khẩu đổi ở trang Tài khoản.
  const mine = accountRow(page, admin.email);
  await expect(mine).toContainText("tài khoản của bạn");
  await expect(mine.getByRole("button")).toHaveCount(0);
  await expect(mine.getByRole("link", { name: "Đổi mật khẩu" })).toBeVisible();

  // Form trống: nói chỗ sai, không tạo gì.
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page.getByRole("alert")).toContainText("Chưa tạo được");
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Mật khẩu ban đầu")).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Tên hiển thị").fill(NAME);
  await page.getByLabel("Mật khẩu ban đầu").fill(INITIAL);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();

  await expect(page.getByRole("status")).toContainText(`Đã tạo tài khoản ${EMAIL}.`);
  const row = accountRow(page, EMAIL);
  await expect(row).toContainText(NAME);
  await expect(row).toContainText("Người nộp mẫu");
  await expect(row).toContainText("Đang dùng");
  // Form đã được xoá: mật khẩu vừa gõ không nằm lại trên trang.
  await expect(page.getByLabel("Mật khẩu ban đầu")).toHaveValue("");

  // Cùng email lần nữa: bị từ chối với lời nói rõ lý do.
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Tên hiển thị").fill("Người khác");
  await page.getByLabel("Mật khẩu ban đầu").fill(INITIAL);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page.getByRole("alert")).toContainText("Email này đã có tài khoản.");
  await expect(page.getByRole("row", { name: new RegExp(EMAIL) })).toHaveCount(1);
});

test("the new user logs in with the initial password and changes it; other logins of the account end", async ({
  page,
  browser,
}) => {
  const other = await elsewhere(browser, INITIAL);
  await logIn(page, EMAIL, INITIAL, NAME);
  await masthead(page).getByRole("link", { name: NAME }).click();
  await expect(page).toHaveURL(/#\/account$/);
  await expect(page.getByRole("main")).toContainText(EMAIL);
  await expect(page.getByRole("main")).toContainText("Người nộp mẫu");

  const current = page.getByLabel("Mật khẩu hiện tại");
  const next = page.getByLabel("Mật khẩu mới", { exact: true });
  const repeat = page.getByLabel("Nhập lại mật khẩu mới");
  const change = page.getByRole("button", { name: "Đổi mật khẩu" });

  // Hai lần nhập không giống nhau: form tự báo, không gửi gì.
  await current.fill(INITIAL);
  await next.fill(OWN);
  await repeat.fill(`${OWN} `);
  await change.click();
  await expect(page.getByRole("main")).toContainText("Hai lần nhập mật khẩu mới không giống nhau.");

  // Sai mật khẩu hiện tại: server từ chối, ô đó được xoá để gõ lại.
  await current.fill("không phải mật khẩu này");
  await repeat.fill(OWN);
  await change.click();
  await expect(page.getByRole("main")).toContainText("Mật khẩu hiện tại không đúng.");
  await expect(current).toHaveValue("");

  await current.fill(INITIAL);
  await change.click();
  await expect(page.getByRole("status")).toContainText("Đã đổi mật khẩu.");
  await expect(next).toHaveValue("");

  // Phiên đang dùng còn; phiên ở trình duyệt khác đã bị kết thúc.
  await page.reload();
  await expect(masthead(page)).toContainText(NAME);
  await expectLoggedOut(other);
  await other.context().close();

  // Mật khẩu ban đầu hết dùng được; mật khẩu mới thì được.
  await expectRefused(browser, INITIAL);
  const again = await elsewhere(browser, OWN);
  await again.context().close();
});

test("an administrator locks the account, unlocks it, and sets a new password", async ({ page, browser }) => {
  const theirs = await elsewhere(browser, OWN);
  await logIn(page, admin.email, admin.password, admin.displayName);
  await page.goto("/#/admin/users");
  const row = accountRow(page, EMAIL);

  await row.getByRole("button", { name: "Khoá", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`Đã khoá ${EMAIL}`);
  await expect(row).toContainText("Đã khoá");
  // Phiên đang mở của người đó kết thúc ngay, và họ không đăng nhập lại được.
  await expectLoggedOut(theirs);
  await theirs.context().close();
  await expectRefused(browser, OWN);

  await row.getByRole("button", { name: "Mở khoá" }).click();
  await expect(page.getByRole("status")).toContainText(`Đã mở khoá ${EMAIL}.`);
  await expect(row).toContainText("Đang dùng");
  const back = await elsewhere(browser, OWN);

  // Đặt lại mật khẩu: mật khẩu quá ngắn bị báo ngay; mật khẩu đạt thì phiên của người đó kết thúc.
  await row.getByRole("button", { name: "Đặt lại mật khẩu" }).click();
  const field = page.getByLabel(`Mật khẩu mới cho ${EMAIL}`);
  await field.fill("ngắn");
  await row.getByRole("button", { name: "Đặt mật khẩu" }).click();
  await expect(row).toContainText("Mật khẩu phải có từ 10 tới 200 ký tự.");
  await field.fill(RESET);
  await row.getByRole("button", { name: "Đặt mật khẩu" }).click();
  await expect(page.getByRole("status")).toContainText(`Đã đặt mật khẩu mới cho ${EMAIL}`);
  await expect(page.getByLabel(`Mật khẩu mới cho ${EMAIL}`)).toHaveCount(0);

  await expectLoggedOut(back);
  await back.context().close();
  await expectRefused(browser, OWN);
  const withReset = await elsewhere(browser, RESET);
  await withReset.context().close();
});

test("a lab account and a guest are turned away from the accounts page and from its API", async ({ page }) => {
  await page.goto("/#/admin/users");
  await expect(page.getByRole("main")).toContainText("Trang này cần đăng nhập.");
  await page.goto("/#/account");
  await expect(page.getByRole("main")).toContainText("Trang này cần đăng nhập.");
  expect((await page.request.get("/api/admin/users")).status()).toBe(401);

  await logIn(page, EMAIL, RESET, NAME);
  await page.goto("/#/admin/users");
  await expect(page.getByRole("main")).toContainText("Trang này chỉ dành cho quản trị viên.");
  await expect(page.locator("table")).toHaveCount(0);
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
  const headers = { "X-Requested-With": "vietstrain" };
  const made = await page.request.post("/api/admin/users", {
    headers,
    data: { email: "x@example.org", displayName: "X", role: "admin", password: RESET },
  });
  expect(made.status()).toBe(403);
});
