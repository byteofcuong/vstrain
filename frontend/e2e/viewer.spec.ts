import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Test đầu-cuối của viewer trên build DENV1 thật. Giá trị mong đợi được tính trong test từ chính các file
 * publish (`tree.json`, `tips.json`, `col.*.json`), không chép cứng, nên test vẫn đúng khi có build mới.
 */
const SLUG = "dengue-denv1";

interface Published {
  manifest: { counts: { nodes: number; tips: number }; dataset: { title: string } };
  tree: { name: string[]; numDate: (number | null)[]; tipNode: number[] };
  tips: { displayName: string[]; accession: (string | null)[] };
  country: { values: string[]; codes: number[] };
}

async function published(request: APIRequestContext): Promise<Published> {
  const datasets = await (await request.get("/api/datasets?limit=500")).json();
  const dataset = datasets.items.find((item: { slug: string }) => item.slug === SLUG);
  const manifestUrl: string = dataset.currentBuild.manifestUrl;
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
  const file = async (name: string) => (await request.get(base + name)).json();
  return {
    manifest: await file("manifest.json"),
    tree: await file("tree.json"),
    tips: await file("tips.json"),
    country: await file("col.country.json"),
  };
}

async function openTree(page: Page): Promise<void> {
  await page.goto(`/#/d/${SLUG}`);
  await page.waitForFunction(() => (window.__vietstrain?.frames ?? 0) > 0 && window.__vietstrain!.stats !== null);
}

const vi = (value: number) => new Intl.NumberFormat("vi-VN").format(value);

/** Bộ sinh số ngẫu nhiên có hạt giống: test chọn cùng 100 tip ở mọi lần chạy. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test("the dataset list links to the tree of a built dataset", async ({ page, request }) => {
  const data = await published(request);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Bộ dữ liệu" })).toBeVisible();
  await expect(page.getByText("Chưa có bản dựng").first()).toBeVisible();
  await page.getByRole("link", { name: data.manifest.dataset.title, exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`#/d/${SLUG}$`));
  await expect(page.getByRole("img", { name: /Cây phát sinh loài/ })).toBeVisible();
});

test("the tree shows every tip of the published build (criterion V2)", async ({ page, request }) => {
  const data = await published(request);
  await openTree(page);

  const shown = await page.evaluate(() => ({
    tipCount: window.__vietstrain!.tipCount,
    visible: window.__vietstrain!.stats!.tipsVisible,
    drawn: window.__vietstrain!.stats!.tipsDrawn,
    branches: window.__vietstrain!.stats!.branchesDrawn,
  }));
  expect(shown.tipCount).toBe(data.manifest.counts.tips);
  expect(shown.visible).toBe(data.manifest.counts.tips);
  expect(shown.drawn).toBeGreaterThan(0);
  expect(shown.drawn).toBeLessThanOrEqual(shown.visible);
  expect(shown.branches).toBeGreaterThan(0);
  await expect(
    page.getByText(`Đang hiện ${vi(data.manifest.counts.tips)} trong ${vi(data.manifest.counts.tips)} mẫu`),
  ).toBeVisible();
  // Mặc định tô màu theo genotype: chú giải có các genotype của DENV1.
  await expect(page.getByRole("button", { name: /DENV1\/I\b/ }).first()).toBeVisible();
});

test("hovering and selecting 100 random tips gives the right sample each time (criterion 3c)", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const data = await published(request);
  await openTree(page);
  const canvas = page.getByRole("img", { name: /Cây phát sinh loài/ });
  const random = seeded(20261012);

  for (let n = 0; n < 100; n++) {
    const tip = Math.floor(random() * data.manifest.counts.tips);
    const expectedId = data.tree.name[data.tree.tipNode[tip]];

    // Về khung nhìn cả cây, rồi phóng hết cỡ quanh tip này để nó tách khỏi các tip chồng lên nó.
    // Phóng làm ba bước nhỏ: toạ độ chuột là số nguyên, nên mỗi bước tip lệch khỏi con trỏ tối đa nửa pixel
    // nhân với hệ số phóng của bước đó; bước sau đặt lại con trỏ vào đúng tip.
    await canvas.press("0");
    let point = await page.evaluate((k) => window.__vietstrain!.tipPoint(k), tip);
    expect(point, `tip ${tip} is on screen in the fitted view`).not.toBeNull();
    for (let step = 0; step < 3; step++) {
      await page.mouse.move(point!.x, point!.y);
      const frames = await page.evaluate(() => window.__vietstrain!.frames);
      await page.mouse.wheel(0, -1000);
      await page.waitForFunction((before) => window.__vietstrain!.frames > before, frames);
      point = await page.evaluate((k) => window.__vietstrain!.tipPoint(k), tip);
      expect(point, `tip ${tip} stays on screen while zooming`).not.toBeNull();
    }

    // Nhích chuột một pixel rồi quay lại, để có sự kiện di chuột tại đúng vị trí của tip.
    await page.mouse.move(point!.x + 1, point!.y + 1);
    await page.mouse.move(point!.x, point!.y);
    await expect(page.getByRole("status").locator("strong")).toHaveText(data.tips.displayName[tip]);

    await page.mouse.click(point!.x, point!.y);
    await expect(page.locator(".sample__facts div", { hasText: "Mã nội bộ" }).locator("dd")).toHaveText(expectedId);
  }
});

test("selecting a legend value filters the tree and the counts agree with the column file", async ({
  page,
  request,
}) => {
  const data = await published(request);
  const total = data.manifest.counts.tips;
  const vietnam = data.country.values.indexOf("Vietnam");
  const expected = data.country.codes.filter((code) => code === vietnam).length;
  expect(expected).toBeGreaterThan(0);
  await openTree(page);

  await page.getByLabel("Tô màu theo").selectOption("country");
  await page.getByRole("button", { name: /^Vietnam/ }).click();

  await expect(page.getByText(`Đang hiện ${vi(expected)} trong ${vi(total)} mẫu`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__vietstrain!.stats!.tipsVisible)).toBe(expected);
  await expect(page.getByRole("button", { name: /^Vietnam/ })).toHaveAttribute("aria-pressed", "true");

  // Bộ lọc còn nguyên khi đổi cột tô màu, và bỏ được bằng một nút.
  await page.getByLabel("Tô màu theo").selectOption("clade");
  await expect(page.getByText("Quốc gia: Vietnam")).toBeVisible();
  await page.getByRole("button", { name: "Bỏ lọc", exact: true }).click();
  await expect(page.getByText(`Đang hiện ${vi(total)} trong ${vi(total)} mẫu`)).toBeVisible();
});

test("the date range filter keeps the tips whose date is inside it", async ({ page, request }) => {
  const data = await published(request);
  const dates = data.tree.tipNode.map((node) => data.tree.numDate[node]);
  const expected = dates.filter((date) => date !== null && date >= 2015 && date < 2018).length;
  expect(expected).toBeGreaterThan(0);
  await openTree(page);

  await page.getByLabel("Từ ngày").fill("2015-01-01");
  await page.getByLabel("Đến ngày").fill("2017-12-31");

  await expect(page.getByText(`Đang hiện ${vi(expected)} trong ${vi(data.manifest.counts.tips)} mẫu`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__vietstrain!.stats!.tipsVisible)).toBe(expected);
});

test("searching by accession opens the details of that sample", async ({ page, request }) => {
  const data = await published(request);
  const tip = data.tips.accession.findIndex((accession) => accession !== null);
  await openTree(page);

  await page.getByLabel("Tìm mẫu").fill(data.tips.accession[tip]!);
  await page.getByRole("button", { name: new RegExp(data.tips.accession[tip]!) }).click();

  const facts = page.locator(".sample__facts");
  await expect(facts.locator("div", { hasText: "Accession" }).locator("dd")).toHaveText(data.tips.accession[tip]!);
  await expect(facts.locator("div", { hasText: "Mã nội bộ" }).locator("dd")).toHaveText(
    data.tree.name[data.tree.tipNode[tip]],
  );
});

test("the layout and the axis can be changed without losing tips", async ({ page, request }) => {
  const data = await published(request);
  await openTree(page);

  for (const choice of ["Toả tròn", "Độ phân kỳ", "Chữ nhật"]) {
    const frames = await page.evaluate(() => window.__vietstrain!.frames);
    await page.getByText(choice, { exact: true }).click();
    await page.waitForFunction((before) => window.__vietstrain!.frames > before, frames);
    const stats = await page.evaluate(() => window.__vietstrain!.stats!);
    expect(stats.tipsVisible).toBe(data.manifest.counts.tips);
    expect(stats.tipsDrawn).toBeGreaterThan(0);
  }
});

test("switching language changes the text without loading the data again (criterion V3)", async ({ page }) => {
  await openTree(page);
  await expect(page.getByLabel("Tô màu theo")).toBeVisible();
  // Chờ các file của dataset tải xong rồi mới bắt đầu đếm.
  await page.waitForLoadState("networkidle");
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/builds/") || path.startsWith("/api/")) requests.push(path);
  });

  await page.getByRole("button", { name: "English" }).click();

  await expect(page.getByLabel("Colour by")).toBeVisible();
  await expect(page.getByText(/^Showing .* of .* samples$/)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(requests).toEqual([]);
});

test("a column that fails to load is reported and can be loaded again", async ({ page }) => {
  let failures = 0;
  await page.route("**/col.country.json", async (route) => {
    // Lần tải đầu tiên của cột này bị cắt giữa chừng; các lần sau đi bình thường.
    if (failures === 0) {
      failures++;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await openTree(page);

  await page.getByLabel("Tô màu theo").selectOption("country");

  const notice = page.getByRole("alert");
  await expect(notice).toContainText("Không tải được dữ liệu của cột này");
  // Lỗi của một cột không làm mất cây.
  expect(await page.evaluate(() => window.__vietstrain!.stats!.tipsVisible)).toBeGreaterThan(0);

  await notice.getByRole("button", { name: "Thử lại" }).click();

  await expect(page.getByRole("button", { name: /^Vietnam/ })).toBeVisible();
  await expect(notice).toHaveCount(0);
  expect(failures).toBe(1);
});
