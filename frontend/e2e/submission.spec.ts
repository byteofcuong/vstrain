import { expect, test, type Page } from "@playwright/test";

import {
  createAccount,
  fastaFile,
  genomesOutsideBuild,
  removeAccount,
  submissionCounts,
  type Account,
  type Genome,
} from "./accounts.mjs";
import { SLUG } from "./support";

/**
 * Luồng nộp mẫu trên stack thật: form, kiểm tra và gắn tạm bằng Nextclade ở worker, tip tạm trên cây, admin ẩn mẫu.
 * Các test chạy lần lượt và dùng chung một mẫu đã nộp; tài khoản và mẫu được xoá khi xong.
 */
test.describe.configure({ mode: "serial" });

// Tên có dấu, có ký tự mà shell coi là đặc biệt: nó chỉ là tên hiển thị, không bao giờ tới công cụ.
const SAMPLE_NAME = "Hà_Nội/01/2024; touch pwned";
let lab: Account;
let admin: Account;
let genome: Genome;
let before: { submissions: number; placements: number };
/** Mã nội bộ của mẫu được nộp ở test nộp mẫu, dùng lại ở các test sau. */
let internalId = "";

test.beforeAll(() => {
  before = submissionCounts();
  [genome] = genomesOutsideBuild(SLUG, 1);
  lab = createAccount();
  admin = createAccount("admin");
});

test.afterAll(() => {
  removeAccount(lab.email);
  removeAccount(admin.email);
  expect(submissionCounts()).toEqual(before);
});

async function logIn(page: Page, account: Account): Promise<void> {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Mật khẩu").fill(account.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.locator(".masthead")).toContainText(account.displayName);
}

const date = (page: Page) => page.getByLabel("Ngày lấy mẫu", { exact: true });
const province = (page: Page) => page.getByLabel("Tỉnh, thành nơi lấy mẫu");
const submitButton = (page: Page) => page.getByRole("button", { name: "Nộp mẫu" });
const hook = (page: Page) => page.evaluate(() => window.__vietstrain?.provisionalDrawn ?? -1);

async function openTip(page: Page, id: string): Promise<void> {
  await page.goto(`/#/d/${SLUG}/t/${id}`);
  await page.waitForFunction(() => (window.__vietstrain?.frames ?? 0) > 0 && window.__vietstrain!.stats !== null);
}

test("a guest is told to log in before submitting, and has no links to the lab pages", async ({ page }) => {
  await page.goto("/#/submit");

  await expect(page.getByRole("heading", { name: "Nộp mẫu" })).toBeVisible();
  await expect(page.getByText("Đăng nhập để nộp mẫu.")).toBeVisible();
  await expect(page.getByLabel("Tên mẫu")).toHaveCount(0);
  await expect(page.locator(".masthead").getByRole("link", { name: "Nộp mẫu" })).toHaveCount(0);

  await page.goto("/#/mine");
  await expect(page.getByText("Đăng nhập để nộp mẫu.")).toBeVisible();
});

test("the list of provinces follows the collection date", async ({ page }) => {
  await logIn(page, lab);
  await page.locator(".masthead").getByRole("link", { name: "Nộp mẫu" }).click();
  await expect(page).toHaveURL(/#\/submit$/);

  // Chưa có ngày thì chưa chọn được tỉnh.
  await expect(province(page)).toBeDisabled();

  await date(page).fill("2024-01-15");
  await expect(province(page)).toBeEnabled();
  await expect(province(page).locator("option:not([value=''])")).toHaveCount(63);
  await province(page).selectOption({ label: "Bình Định" });

  // Sau ngày sáp nhập: 34 đơn vị, và tỉnh cũ vừa chọn không còn được giữ.
  await date(page).fill("2025-08-01");
  await expect(province(page).locator("option:not([value=''])")).toHaveCount(34);
  await expect(province(page)).toHaveValue("");

  // Chỉ biết năm 2025: mẫu có thể thuộc bên nào của ngày sáp nhập, nên có cả hai bộ, ghi rõ từng bộ.
  await page.getByRole("group", { name: "Ngày lấy mẫu biết tới" }).getByText("Năm").click();
  await date(page).fill("2025");
  await expect(province(page).locator("optgroup")).toHaveCount(2);
  await expect(province(page).locator("option:not([value=''])")).toHaveCount(97);
});

test("a form with nothing in it, or with a file that is not FASTA, says what to fix and submits nothing", async ({
  page,
}) => {
  await logIn(page, lab);
  await page.goto("/#/submit");

  await submitButton(page).click();

  await expect(page.getByRole("alert")).toContainText("Chưa nộp được");
  for (const problem of [
    "Tên mẫu phải có từ 1 tới 300 ký tự",
    "Ngày lấy mẫu không hợp lệ.",
    "Chọn một tỉnh, thành trong danh sách.",
    "Chọn một file FASTA.",
  ]) {
    await expect(page.getByText(problem)).toBeVisible();
  }
  await expect(page.getByLabel("Tên mẫu")).toHaveAttribute("aria-invalid", "true");

  // Điền đủ, nhưng file là văn bản thường: server từ chối và form nói đúng lý do ở đúng ô.
  await page.getByLabel("Tên mẫu").fill(SAMPLE_NAME);
  await date(page).fill(genome.date);
  await province(page).selectOption({ label: "Hà Nội" });
  await page.getByLabel("File FASTA").setInputFiles(fastaFile("ghi-chu.txt", "đây là ghi chú, không phải FASTA"));
  await submitButton(page).click();

  await expect(page.getByText("File không phải FASTA")).toBeVisible();
  await expect(page.getByLabel("File FASTA")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Tên mẫu")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/#\/submit$/);
  expect((await (await page.request.get("/api/submissions")).json()).total).toBe(0);
});

test("a lab submits a genome and finds it on the tree as a provisional sample within thirty seconds", async ({
  page,
}) => {
  await logIn(page, lab);
  await page.goto("/#/submit");
  await page.getByLabel("Tên mẫu").fill(SAMPLE_NAME);
  await date(page).fill(genome.date);
  await province(page).selectOption({ label: "Hà Nội" });
  await page.getByLabel("File FASTA").setInputFiles(fastaFile("mau.fasta", `>ten trong file\n${genome.sequence}\n`));

  const started = Date.now();
  await submitButton(page).click();

  // Sang trang "Mẫu của tôi": có lời báo đã nhận, và dòng của mẫu tự chuyển sang "mẫu tạm" khi worker làm xong.
  await expect(page).toHaveURL(/#\/mine$/);
  await expect(page.getByRole("status")).toContainText(`Đã nhận mẫu ${SAMPLE_NAME}`);
  const row = page.getByRole("row", { name: new RegExp(SAMPLE_NAME.slice(0, 14)) });
  await expect(row).toContainText("Đang là mẫu tạm trên cây", { timeout: 30_000 });
  expect(Date.now() - started).toBeLessThan(30_000);
  await expect(row).toContainText(genome.date);
  await expect(row).toContainText("Hà Nội");
  await expect(row).toContainText("DENV1");

  const mine = await (await page.request.get("/api/submissions")).json();
  expect(mine.total).toBe(1);
  internalId = mine.items[0].internalId;
  expect(internalId).toMatch(/^S\d{7,}$/);

  // Từ đó đi thẳng tới cây, với mẫu này được chọn sẵn.
  await row.getByRole("link", { name: /Xem trên cây/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/d/${SLUG}/t/${internalId}$`));
  const panel = page.getByRole("complementary", { name: "Mẫu tạm" });
  await expect(panel.getByRole("heading")).toContainText(SAMPLE_NAME);
  await expect(panel.getByRole("heading")).toContainText("tạm");
  await expect(panel).toContainText("Vị trí trên cây là tạm thời");
  await expect(panel).toContainText(genome.date);
  await expect(panel).toContainText("Hà Nội");
  await expect(panel).toContainText(internalId);
  // Người nộp không phải admin: không có nút ẩn.
  await expect(panel.getByRole("button", { name: "Ẩn mẫu này" })).toHaveCount(0);
});

test("anyone sees the provisional sample on the tree, marked as provisional, and can switch such samples off", async ({
  page,
}) => {
  const listed = await (await page.request.get(`/api/datasets/${SLUG}/placements`)).json();
  expect(listed.items.map((item: { internalId: string }) => item.internalId)).toContain(internalId);

  await openTip(page, internalId);

  // Thanh bên nói có bao nhiêu mẫu tạm và chúng là gì.
  const section = page.locator(".provisional");
  await expect(section).toContainText(`${listed.items.length} mẫu vừa nộp, chưa qua lần dựng cây nào.`);
  await expect(section).toContainText("Vị trí chính thức có sau lần dựng cây kế tiếp.");
  expect(await hook(page)).toBe(listed.items.length);

  // Rê chuột vào hình thoi của mẫu: tooltip ghi tên người nộp đã gõ và chữ "tạm".
  const point = await page.evaluate((id) => window.__vietstrain!.provisionalPoint(id), internalId);
  expect(point).not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
  const tooltip = page.locator(".tooltip");
  await expect(tooltip).toContainText(SAMPLE_NAME);
  await expect(tooltip).toContainText("tạm");
  await expect(tooltip).toContainText("thay thế nucleotide so với chỗ gắn");

  // Đổi trục và bố cục: tip tạm vẫn được vẽ.
  await page.getByText("Độ phân kỳ").click();
  await expect.poll(() => hook(page)).toBe(listed.items.length);
  await page.getByText("Toả tròn").click();
  await expect.poll(() => hook(page)).toBe(listed.items.length);

  // Tắt các mẫu tạm: không còn hình thoi nào, và bảng chi tiết của mẫu đang chọn cũng đóng.
  await page.getByRole("group", { name: "Mẫu tạm" }).getByText("Ẩn").click();
  await expect.poll(() => hook(page)).toBe(0);
  await expect(page.getByRole("complementary", { name: "Mẫu tạm" })).toHaveCount(0);
  expect(await page.evaluate((id) => window.__vietstrain!.provisionalPoint(id), internalId)).toBeNull();

  // Bấm vào đúng chỗ đó khi mẫu tạm đang bật thì mở lại bảng chi tiết.
  await page.getByText("Chữ nhật").click();
  await page.getByRole("group", { name: "Mẫu tạm" }).getByText("Hiện").click();
  await expect.poll(() => hook(page)).toBe(listed.items.length);
  const again = await page.evaluate((id) => window.__vietstrain!.provisionalPoint(id), internalId);
  await page.mouse.click(again!.x, again!.y);
  await expect(page.getByRole("complementary", { name: "Mẫu tạm" }).getByRole("heading")).toContainText(SAMPLE_NAME);
});

test("an administrator hides the sample, which takes it off the tree, and can bring it back", async ({
  page,
  browser,
}) => {
  await logIn(page, admin);
  await openTip(page, internalId);
  const panel = page.getByRole("complementary", { name: "Mẫu tạm" });

  await panel.getByRole("button", { name: "Ẩn mẫu này" }).click();

  // Mẫu rời cây ngay, với mọi người xem.
  await expect(panel).toHaveCount(0);
  await expect.poll(() => page.evaluate((id) => window.__vietstrain!.provisionalPoint(id), internalId)).toBeNull();
  const listed = await (await page.request.get(`/api/datasets/${SLUG}/placements`)).json();
  expect(listed.items.map((item: { internalId: string }) => item.internalId)).not.toContain(internalId);
  expect((await page.request.get(`/api/samples/${internalId}`)).status()).toBe(404);

  // Người nộp thấy mẫu của mình đã bị ẩn.
  const labContext = await browser.newContext();
  const labPage = await labContext.newPage();
  await logIn(labPage, lab);
  await labPage.goto("/#/mine");
  await expect(labPage.getByRole("row", { name: new RegExp(SAMPLE_NAME.slice(0, 14)) })).toContainText(
    "Đã bị quản trị viên ẩn",
  );
  await labContext.close();

  // Admin xem mọi mẫu đã nộp và hiện lại mẫu này.
  await page.goto("/#/mine");
  await page.getByRole("group", { name: "Danh sách" }).getByText("Mọi mẫu đã nộp").click();
  const row = page.getByRole("row", { name: new RegExp(SAMPLE_NAME.slice(0, 14)) });
  await expect(row).toContainText(lab.displayName);
  await row.getByRole("button", { name: "Hiện lại" }).click();
  await expect(row).toContainText("Đang là mẫu tạm trên cây");
  const restored = await (await page.request.get(`/api/datasets/${SLUG}/placements`)).json();
  expect(restored.items.map((item: { internalId: string }) => item.internalId)).toContain(internalId);
});

test("a lab corrects the name and province of its sample, and the tree shows the corrected sample", async ({
  page,
  browser,
}) => {
  const corrected = "Đà_Nẵng/02/2024 đã sửa";
  await logIn(page, lab);
  await page.goto("/#/mine");
  await page
    .getByRole("row", { name: new RegExp(SAMPLE_NAME.slice(0, 14)) })
    .getByRole("link", { name: "Sửa" })
    .click();

  // Form sửa mở ra với đúng các giá trị đang có; không có ô chọn file, vì chuỗi không sửa được.
  await expect(page).toHaveURL(new RegExp(`#/mine/${internalId}/edit$`));
  await expect(page.getByRole("heading", { name: "Sửa thông tin mẫu" })).toBeVisible();
  await expect(page.getByLabel("Tên mẫu")).toHaveValue(SAMPLE_NAME);
  await expect(date(page)).toHaveValue(genome.date);
  await expect(province(page)).toHaveValue(/:ha-noi$/);
  await expect(page.getByLabel("File FASTA")).toHaveCount(0);

  // Bỏ trống tên: form nói chỗ sai và không gửi gì.
  await page.getByLabel("Tên mẫu").fill("   ");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByRole("alert")).toContainText("Chưa lưu được. Sửa các chỗ được đánh dấu rồi lưu lại.");
  await expect(page.getByLabel("Tên mẫu")).toHaveAttribute("aria-invalid", "true");
  expect((await (await page.request.get(`/api/submissions/${internalId}`)).json()).displayName).toBe(SAMPLE_NAME);

  await page.getByLabel("Tên mẫu").fill(corrected);
  await province(page).selectOption({ label: "Đà Nẵng" });
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();

  // Về trang "Mẫu của tôi": lời báo đã lưu, và dòng của mẫu mang tên và tỉnh mới, vẫn là mẫu đó.
  await expect(page).toHaveURL(/#\/mine$/);
  await expect(page.getByRole("status")).toContainText(`Đã lưu thay đổi của mẫu ${corrected}`);
  const row = page.getByRole("row", { name: new RegExp(corrected.slice(0, 14)) });
  await expect(row).toContainText("Đà Nẵng");
  await expect(row).toContainText(internalId);
  await expect(row).toContainText("Đang là mẫu tạm trên cây");
  await expect(page.getByRole("row", { name: new RegExp(SAMPLE_NAME.slice(0, 14)) })).toHaveCount(0);

  // Trên cây, với mọi người xem: tip tạm mang tên và tỉnh mới ngay, không chờ lần dựng cây nào.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await openTip(guestPage, internalId);
  const panel = guestPage.getByRole("complementary", { name: "Mẫu tạm" });
  await expect(panel.getByRole("heading")).toContainText(corrected);
  await expect(panel).toContainText("Đà Nẵng");
  await expect(panel).not.toContainText("Hà Nội");
  // Khách mở thẳng địa chỉ của form sửa thì được mời đăng nhập.
  await guestPage.goto(`/#/mine/${internalId}/edit`);
  await expect(guestPage.getByText("Đăng nhập để nộp mẫu.")).toBeVisible();
  await expect(guestPage.getByLabel("Tên mẫu")).toHaveCount(0);
  await guest.close();
});

test("an administrator sees the sample of a lab but cannot correct it", async ({ page }) => {
  await logIn(page, admin);
  await page.goto("/#/mine");
  await page.getByRole("group", { name: "Danh sách" }).getByText("Mọi mẫu đã nộp").click();
  const row = page.getByRole("row", { name: new RegExp(lab.displayName) });
  await expect(row).toContainText(internalId);
  await expect(row.getByRole("link", { name: "Sửa" })).toHaveCount(0);

  // Gõ thẳng địa chỉ của form: quyền được kiểm ở API, và lời từ chối nói rõ lý do.
  await page.goto(`/#/mine/${internalId}/edit`);
  await page.getByLabel("Tên mẫu").fill("tên do admin đặt");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByRole("alert")).toContainText("Chỉ tài khoản đã nộp mẫu mới sửa được nó.");
  expect((await (await page.request.get(`/api/submissions/${internalId}`)).json()).displayName).not.toBe(
    "tên do admin đặt",
  );
});
