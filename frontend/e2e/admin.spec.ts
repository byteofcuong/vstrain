import { expect, test, type Page } from "@playwright/test";

import { createAccount, removeAccount, type Account } from "./accounts.mjs";
import {
  buildJobs,
  createEmptyDataset,
  createUnresolvedSample,
  placeOf,
  removeOperationsData,
  type TempDataset,
  type TempPlace,
} from "./operations.mjs";

/**
 * Ba trang quản trị trên stack thật. Dataset dùng để thử là một dataset tạm không chọn được mẫu nào: dựng nó thì
 * worker thật chạy job và job hỏng ngay ở bước chọn mẫu, nên có một job hỏng thật để xem và chạy lại mà không phải
 * dựng lại cây DENV1. Mọi thứ tạo ra ở đây được xoá khi xong.
 */
test.describe.configure({ mode: "serial" });

let admin: Account;
let lab: Account;
let dataset: TempDataset;
let place: TempPlace;

test.beforeAll(() => {
  admin = createAccount("admin");
  lab = createAccount();
  dataset = createEmptyDataset();
  place = createUnresolvedSample();
});

test.afterAll(() => {
  const left = removeOperationsData(dataset, place);
  removeAccount(admin.email);
  removeAccount(lab.email);
  expect(left).toBe(0);
});

async function logIn(page: Page, account: Account): Promise<void> {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Mật khẩu").fill(account.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.locator(".masthead")).toContainText(account.displayName);
}

const jobRow = (page: Page, id: number) => page.locator(`tr[data-job="${id}"]`);
const notice = (page: Page) => page.getByRole("status");
const filter = (page: Page, label: string) => page.locator(".choice label").filter({ hasText: label });

test("the administration pages turn away a guest and a lab account", async ({ page }) => {
  await page.goto("/#/admin/jobs");
  await expect(page.getByRole("main")).toContainText("Trang này cần đăng nhập.");
  await expect(page.getByRole("link", { name: "Quản trị" })).toHaveCount(0);

  await logIn(page, lab);
  await expect(page.getByRole("link", { name: "Quản trị" })).toHaveCount(0);
  for (const section of ["jobs", "datasets", "places", "users"]) {
    await page.goto(`/#/admin/${section}`);
    await expect(page.getByRole("main")).toContainText("Trang này chỉ dành cho quản trị viên.");
    await expect(page.locator("table")).toHaveCount(0);
  }
  // Trang chỉ là lớp ngoài: chính API từ chối tài khoản này.
  expect((await page.request.get("/api/admin/jobs")).status()).toBe(403);
  expect((await page.request.get("/api/admin/places/unresolved")).status()).toBe(403);
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
});

test("an administrator gives a dataset a build schedule, and it is still there after a reload", async ({ page }) => {
  await logIn(page, admin);
  await page.getByRole("link", { name: "Quản trị" }).click();
  await page.getByRole("link", { name: "Lịch dựng cây" }).click();
  const schedule = page.getByLabel(`Lịch dựng lại của ${dataset.title}`);
  await expect(schedule).toHaveValue("off");
  await expect(page.locator(`tr[data-dataset="${dataset.slug}"]`)).toContainText("Chưa có bản dựng");

  await schedule.selectOption({ label: "Mỗi ngày" });

  await expect(notice(page)).toHaveText(`Đã lưu lịch của ${dataset.title}.`);
  // Ai cũng thấy được lịch của một bộ dữ liệu.
  const shown = await (await page.request.get(`/api/datasets/${dataset.slug}`)).json();
  expect(shown.buildIntervalHours).toBe(24);
  await page.reload();
  await expect(page.getByLabel(`Lịch dựng lại của ${dataset.title}`)).toHaveValue("24");

  // Màn hình điện thoại: thanh đầu trang của admin (nhiều liên kết nhất) xuống dòng, trang không bị kéo rộng.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel(`Lịch dựng lại của ${dataset.title}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Tắt lịch lại, để worker không xét dataset tạm này nữa.
  await page.getByLabel(`Lịch dựng lại của ${dataset.title}`).selectOption({ label: "Không tự dựng" });
  await expect(notice(page)).toHaveText(`Đã lưu lịch của ${dataset.title}.`);
  expect((await (await page.request.get(`/api/datasets/${dataset.slug}`)).json()).buildIntervalHours).toBeNull();
});

test("an administrator asks for a build, sees it fail, reads why, and runs it again", async ({ page }) => {
  await logIn(page, admin);
  await page.goto("/#/admin/datasets");

  await page.getByRole("button", { name: `Dựng ngay: ${dataset.title}` }).click();

  await expect(notice(page)).toContainText("Đã xếp việc dựng cây");
  const [first] = buildJobs(dataset);
  await expect(notice(page)).toContainText(`Đã xếp việc dựng cây ${first.id} cho ${dataset.title}.`);
  await notice(page).getByRole("link", { name: "Xem công việc nền" }).click();

  // Trang tự tải lại trong lúc còn việc chờ hoặc đang chạy: không ai bấm gì, việc vẫn chuyển sang "Hỏng".
  const row = jobRow(page, first.id);
  await expect(row).toContainText("Dựng cây");
  await expect(row).toContainText(dataset.slug);
  await expect(row.locator(".state")).toHaveText("Hỏng", { timeout: 20_000 });
  await expect(row).toContainText("No eligible samples");

  await row.getByRole("button", { name: `Chi tiết công việc ${first.id}` }).click();
  const details = page.locator(".job");
  await expect(details.locator("pre.log").first()).toContainText(`No eligible samples for dataset ${dataset.slug}`);
  await expect(details.getByRole("row", { name: /select/ })).toContainText("Hỏng");

  await details.getByRole("button", { name: "Chạy lại" }).click();

  await expect(notice(page)).toContainText("để chạy lại");
  const [, second] = buildJobs(dataset);
  expect(second.id).toBeGreaterThan(first.id);
  await expect(notice(page)).toHaveText(`Đã xếp việc ${second.id} để chạy lại.`);
  await expect(jobRow(page, second.id).locator(".state")).toHaveText("Hỏng", { timeout: 20_000 });
  // Việc cũ còn nguyên, biết nó đã được chạy lại bằng việc nào, và không chạy lại lần hai được.
  await expect(details).toContainText(`Đã được chạy lại bằng việc ${second.id}`);
  await expect(details.getByRole("button", { name: "Chạy lại" })).toHaveCount(0);
  expect(buildJobs(dataset).map((job) => job.status)).toEqual(["failed", "failed"]);

  // Lọc theo tình trạng: cả hai việc nằm trong danh sách việc hỏng, không nằm trong danh sách việc xong.
  await filter(page, "Xong").click();
  await expect(jobRow(page, second.id)).toHaveCount(0);
  await filter(page, "Hỏng").click();
  await expect(jobRow(page, first.id)).toBeVisible();
  await expect(jobRow(page, second.id)).toBeVisible();
});

test("an administrator maps an unknown spelling to a province, and takes it back", async ({ page }) => {
  expect(placeOf(place)).toEqual({ status: "unresolved", unit: null });
  await logIn(page, admin);
  await page.goto("/#/admin/places");
  const row = page.locator(`tr[data-place="${place.key}"]`);
  await expect(row).toContainText(place.text);
  const assign = page.getByRole("button", { name: `Gán: ${place.text}` });
  // Chưa chọn đơn vị thì chưa gán được.
  await expect(assign).toBeDisabled();

  await page.getByLabel(`Đơn vị của ${place.text}`).selectOption("vn63:khanh-hoa");
  await assign.click();

  await expect(notice(page)).toContainText(`Đã gán ${place.text}: 1 mẫu được xếp lại.`);
  await expect(row).toHaveCount(0);
  expect(placeOf(place)).toEqual({ status: "province", unit: "vn63:khanh-hoa" });
  const sample = await (await page.request.get(`/api/samples/${place.internalId}`)).json();
  expect([sample.geoStatus, sample.unitCode, sample.division]).toEqual(["province", "vn63:khanh-hoa", place.text]);
  const alias = page.locator(`tr[data-alias="${place.key}"]`);
  await expect(alias).toContainText(place.text);
  await expect(alias).toContainText("Khánh Hòa");

  await page.getByRole("button", { name: `Bỏ: ${place.text}` }).click();

  await expect(notice(page)).toContainText(`Đã bỏ ${place.text}: 1 mẫu được xếp lại.`);
  await expect(alias).toHaveCount(0);
  await expect(row).toContainText(place.text);
  expect(placeOf(place)).toEqual({ status: "unresolved", unit: null });
});
