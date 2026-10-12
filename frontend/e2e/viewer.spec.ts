import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Test đầu-cuối của viewer trên build DENV1 thật. Giá trị mong đợi được tính trong test từ chính các file
 * publish (`tree.json`, `tips.json`, `col.*.json`), không chép cứng, nên test vẫn đúng khi có build mới.
 */
const SLUG = "dengue-denv1";

interface ColumnFile {
  values: string[];
  labels?: string[];
  codes: number[];
}

interface Published {
  manifest: {
    counts: { nodes: number; tips: number };
    dataset: { title: string };
    columns: { key: string; title: { vi: string; en: string } }[];
  };
  tree: { name: string[]; numDate: (number | null)[]; tipNode: number[] };
  tips: { displayName: string[]; accession: (string | null)[]; collectionDate: (string | null)[] };
  /** Cột genotype, mỗi node một mã. */
  clade: ColumnFile;
  /** Cột quốc gia, mỗi tip một mã. */
  country: ColumnFile;
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
    clade: await file("col.clade.json"),
    country: await file("col.country.json"),
  };
}

const DAY = 86_400_000;

/** Vị trí của một thời điểm (năm thập phân) trong năm của nó, tính bằng ngày: phần nguyên là ngày thứ mấy, từ 0. */
function dayPosition(decimalYear: number): number {
  const year = Math.floor(decimalYear);
  return ((decimalYear - year) * (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1))) / DAY;
}

/** Ngày lịch chứa một thời điểm ghi bằng năm thập phân; tính lại ở đây, không dùng mã của viewer. */
function dayOf(decimalYear: number): string {
  const days = Math.floor(dayPosition(decimalYear) + 1e-6);
  return new Date(Date.UTC(Math.floor(decimalYear), 0, 1) + days * DAY).toISOString().slice(0, 10);
}

/** Mẫu khớp một ngày lấy mẫu đã khai: "2020-09-XX" khớp mọi ngày của tháng 9 năm 2020. */
function declaredDate(text: string): RegExp {
  return new RegExp(`^${text.replace(/X/g, "\\d")}$`);
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
});

test("the date range is the one of the tips in the published tree (criterion V2)", async ({ page, request }) => {
  const data = await published(request);
  const dates = data.tree.tipNode.map((node) => data.tree.numDate[node]!);
  const earliest = dates.indexOf(Math.min(...dates));
  const latest = dates.indexOf(Math.max(...dates));
  const [first, last] = [dayOf(dates[earliest]), dayOf(dates[latest])];
  // Hai ngày này phải nằm trong ngày lấy mẫu đã khai của chính hai tip đó.
  expect(first).toMatch(declaredDate(data.tips.collectionDate[earliest]!));
  expect(last).toMatch(declaredDate(data.tips.collectionDate[latest]!));
  await openTree(page);

  for (const label of ["Từ ngày", "Đến ngày"]) {
    await expect(page.getByLabel(label)).toHaveAttribute("min", first);
    await expect(page.getByLabel(label)).toHaveAttribute("max", last);
  }
});

test("the colour columns and the legend counts agree with the manifest and the column file (criterion V2)", async ({
  page,
  request,
}) => {
  const data = await published(request);
  const labels = data.clade.labels ?? data.clade.values;
  const counts = labels.map(() => 0);
  let missing = 0;
  for (const node of data.tree.tipNode) {
    if (data.clade.codes[node] < 0) missing++;
    else counts[data.clade.codes[node]]++;
  }
  const expected: Record<string, string> = Object.fromEntries(labels.map((label, code) => [label, vi(counts[code])]));
  if (missing > 0) expected["Không có thông tin"] = vi(missing);
  await openTree(page);

  const select = page.getByLabel("Tô màu theo");
  await expect(select.locator("option")).toHaveText([
    "Không tô màu",
    ...data.manifest.columns.map((column) => column.title.vi),
  ]);
  // Mặc định tô màu theo genotype.
  await expect(select).toHaveValue("clade");

  const rows = page.locator(".legend__row");
  await expect(rows).toHaveCount(Object.keys(expected).length);
  const shown = await rows.evaluateAll((elements) =>
    elements.map((element) => ({
      label: element.querySelector(".legend__label")!.textContent,
      count: element.querySelector(".legend__count")!.textContent,
      color: getComputedStyle(element.querySelector(".swatch")!).backgroundColor,
    })),
  );
  expect(Object.fromEntries(shown.map((row) => [row.label, row.count]))).toEqual(expected);
  // Tối đa tám giá trị có màu riêng; mỗi giá trị trong số đó một màu khác nhau.
  const distinct = Math.min(8, labels.length);
  expect(new Set(shown.slice(0, distinct).map((row) => row.color)).size).toBe(distinct);
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
    const facts = page.locator(".sample__facts");
    await expect(facts.locator("div", { hasText: "Mã nội bộ" }).locator("dd")).toHaveText(expectedId);
    // Ngày của tip trên cây nằm trong ngày lấy mẫu đã khai (phần "XX" là phần không được khai).
    const declared = data.tips.collectionDate[tip];
    if (declared !== null) {
      await expect(facts.locator("div", { hasText: "Ngày trên cây" }).locator("dd")).toHaveText(declaredDate(declared));
    }
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

test("both days of the date range are included, up to the last moment of the closing day", async ({
  page,
  request,
}) => {
  const data = await published(request);
  const total = data.manifest.counts.tips;
  const days = data.tree.tipNode.map((node) => dayOf(data.tree.numDate[node]!));
  // Ngày của tip nằm muộn nhất trong ngày của nó: nơi một cận đặt lỏng tay sẽ làm rơi tip.
  const lateness = data.tree.tipNode.map((node) => (dayPosition(data.tree.numDate[node]!) + 1e-6) % 1);
  const day = days[lateness.indexOf(Math.max(...lateness))];
  const count = (keep: (other: string) => boolean) => days.filter(keep).length;
  await openTree(page);

  const shows = async (expected: number) => {
    await expect(page.getByText(`Đang hiện ${vi(expected)} trong ${vi(total)} mẫu`)).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__vietstrain!.stats!.tipsVisible)).toBe(expected);
  };
  await page.getByLabel("Từ ngày").fill(day);
  await page.getByLabel("Đến ngày").fill(day);
  await shows(count((other) => other === day));

  await page.getByLabel("Từ ngày").fill("");
  await shows(count((other) => other <= day));

  await page.getByLabel("Từ ngày").fill(day);
  await page.getByLabel("Đến ngày").fill("");
  await shows(count((other) => other >= day));
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
