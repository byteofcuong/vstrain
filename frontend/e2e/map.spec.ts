import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { openTree, publishedFiles, vi, type ColumnFile } from "./support";

/**
 * Test đầu-cuối của bản đồ trên build DENV1 thật. Số mẫu mong đợi của từng địa bàn được tính lại ở đây từ các
 * file cột của bản publish, bằng một cách viết riêng của quy tắc xếp mẫu (đặc tả `SPEC-map.md`), không dùng mã
 * của viewer.
 */
type Level = "macro" | "region" | "vn63" | "vn34";

interface Area {
  code: string;
  vi: string;
  parent?: string;
  successor?: string;
  d: string;
  dots?: string;
  at: [number, number];
}

interface MapFile {
  width: number;
  height: number;
  levels: Record<Level, Area[]>;
}

interface Published {
  tipCount: number;
  /** Với mỗi tip: mã tỉnh, mã vùng hoặc miền, tên quốc gia, genotype; `null` là không có. */
  unit: (string | null)[];
  region: (string | null)[];
  country: (string | null)[];
  clade: (string | null)[];
}

async function published(request: APIRequestContext): Promise<Published> {
  const file = await publishedFiles(request);
  const tree = await file<{ tipNode: number[] }>("tree.json");
  const cells = (column: ColumnFile, codes: number[]) => codes.map((code) => (code < 0 ? null : column.values[code]));
  const ofTips = async (key: string) => {
    const column = await file<ColumnFile>(`col.${key}.json`);
    return cells(column, column.codes);
  };
  const clade = await file<ColumnFile>("col.clade.json");
  return {
    tipCount: tree.tipNode.length,
    unit: await ofTips("unit"),
    region: await ofTips("region"),
    country: await ofTips("country"),
    // Genotype là cột theo node: mã của tip nằm ở node của nó.
    clade: cells(
      clade,
      tree.tipNode.map((node) => clade.codes[node]),
    ),
  };
}

/** Mở trang của dataset và lấy file hình học mà trang tải cho bản đồ. */
async function openMap(page: Page): Promise<MapFile> {
  const asset = page.waitForResponse((response) =>
    /\/assets\/vn-map-[\w-]+\.json$/.test(new URL(response.url()).pathname),
  );
  await openTree(page);
  const map: MapFile = await (await asset).json();
  await expect(page.locator(".map__svg")).toBeVisible();
  return map;
}

/** Địa bàn chứa nơi lấy một mẫu ở một cấp, theo quy tắc của đặc tả; `null` là không xếp được. */
function areaOf(map: MapFile, level: Level, unit: string | null, region: string | null): string | null {
  const province = map.levels.vn63.find((area) => area.code === unit);
  const isCurrent = map.levels.vn34.some((area) => area.code === unit);
  if (level === "vn63") return province?.code ?? null;
  if (level === "vn34") return isCurrent ? unit : (province?.successor ?? null);

  const regionCalled = (code: string | null | undefined) => map.levels.region.find((area) => area.code === code);
  // Vùng của nơi lấy mẫu: vùng của tỉnh cũ; với đơn vị mới thì là vùng chung của mọi tỉnh gộp vào nó, nếu có.
  const merged = map.levels.vn63.filter((area) => area.successor === unit);
  const regions = province ? [province.parent] : isCurrent ? [...new Set(merged.map((area) => area.parent))] : [];
  if (level === "region") {
    if (regions.length === 1) return regions[0] ?? null;
    return regionCalled(region) ? region : null;
  }
  const macros = [...new Set(regions.map((code) => regionCalled(code)?.parent))];
  if (macros.length === 1) return macros[0] ?? null;
  if (map.levels.macro.some((area) => area.code === region)) return region;
  return regionCalled(region)?.parent ?? null;
}

/** Số mẫu của từng địa bàn ở một cấp, trong các tip thoả `keep`. */
function totals(map: MapFile, level: Level, data: Published, keep: (tip: number) => boolean = () => true) {
  const counts = new Map(map.levels[level].map((area) => [area.code, 0]));
  let home = 0;
  let placed = 0;
  for (let tip = 0; tip < data.tipCount; tip++) {
    if (!keep(tip)) continue;
    const code = areaOf(map, level, data.unit[tip], data.region[tip]);
    if (code !== null) counts.set(code, counts.get(code)! + 1);
    if (data.country[tip] === "Vietnam") {
      home++;
      if (code !== null) placed++;
    }
  }
  return { counts, home, placed };
}

const GRAIN = { macro: "Miền", region: "Vùng", vn34: "Tỉnh", vn63: "Tỉnh" } as const;
const WORD = { macro: "miền", region: "vùng", vn34: "tỉnh", vn63: "tỉnh" } as const;

/** Chuyển bản đồ sang một cấp bằng các nút của nó. */
async function showLevel(page: Page, level: Level): Promise<void> {
  const panel = page.locator(".map");
  await panel.getByText(GRAIN[level], { exact: true }).click();
  if (level === "vn34") await panel.getByText("34 đơn vị", { exact: true }).click();
  if (level === "vn63") await panel.getByText("63 tỉnh", { exact: true }).click();
  await expect(page.locator(".map__svg")).toHaveAttribute("data-level", level);
}

/** Số mẫu đang hiện và tổng số mẫu mà bản đồ ghi cho từng địa bàn. */
async function shownOnMap(page: Page): Promise<Record<string, [number, number]>> {
  const rows = await page.locator(".map__area").evaluateAll((elements) =>
    elements.map((element) => ({
      code: element.getAttribute("data-code")!,
      shown: Number(element.getAttribute("data-shown")),
      total: Number(element.getAttribute("data-total")),
    })),
  );
  return Object.fromEntries(rows.map(({ code, shown, total }) => [code, [shown, total]]));
}

/** Toạ độ trên trang của điểm neo của một địa bàn: một điểm nằm trong hình của nó. */
async function anchorOf(page: Page, map: MapFile, level: Level, code: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator(".map__svg").boundingBox())!;
  const area = map.levels[level].find((candidate) => candidate.code === code)!;
  return { x: box.x + (area.at[0] / map.width) * box.width, y: box.y + (area.at[1] / map.height) * box.height };
}

const LEVELS: Level[] = ["macro", "region", "vn34", "vn63"];

test("the map has every area of each level, and opens at the finest level that places half the samples (criterion B1)", async ({
  page,
  request,
}) => {
  const data = await published(request);
  const map = await openMap(page);

  // Cấp mở đầu: cấp mịn nhất xếp được ít nhất một nửa số mẫu Việt Nam.
  const opening = (["vn34", "region", "macro"] as const).find((level) => {
    const { home, placed } = totals(map, level, data);
    return placed * 2 >= home;
  });
  expect(opening, "this build places half of its Vietnamese samples at some level").toBeDefined();
  await expect(page.locator(".map__svg")).toHaveAttribute("data-level", opening!);

  for (const [level, count] of [
    ["macro", 3],
    ["region", 6],
    ["vn34", 34],
    ["vn63", 63],
  ] as const) {
    await showLevel(page, level);
    const codes = await page
      .locator(".map__area")
      .evaluateAll((all) => all.map((one) => one.getAttribute("data-code")));
    expect(codes, level).toHaveLength(count);
    expect(codes, level).toEqual(map.levels[level].map((area) => area.code));
  }
});

test("the counts of every area agree with the published columns at every level (criterion B2)", async ({
  page,
  request,
}) => {
  const data = await published(request);
  const map = await openMap(page);

  for (const level of LEVELS) {
    const expected = totals(map, level, data);
    await showLevel(page, level);

    const shown = await shownOnMap(page);
    expect(shown, level).toEqual(
      Object.fromEntries([...expected.counts].map(([code, count]) => [code, [count, count]])),
    );
    const summary = page.locator(".map__summary");
    await expect(summary, level).toContainText(
      `${vi(expected.placed)} trong ${vi(expected.home)} mẫu Việt Nam đang hiện xếp được theo ${WORD[level]}.`,
    );
    if (expected.placed < expected.home) {
      await expect(summary, level).toContainText(`${vi(expected.home - expected.placed)} mẫu còn lại`);
    }
    // Danh sách bên dưới liệt kê đúng những địa bàn có mẫu.
    await expect(page.locator(".map__row"), level).toHaveCount([...expected.counts.values()].filter(Boolean).length);
  }
});

test("selecting an area filters the tree and the legend, and a legend filter changes the map (criterion B3)", async ({
  page,
  request,
}) => {
  const data = await published(request);
  const map = await openMap(page);
  await showLevel(page, "macro");
  const all = totals(map, "macro", data);
  // Miền có nhiều mẫu nhất.
  const [code, inArea] = [...all.counts].sort((a, b) => b[1] - a[1])[0];
  const name = map.levels.macro.find((area) => area.code === code)!.vi;
  expect(inArea).toBeGreaterThan(0);
  expect(inArea).toBeLessThan(data.tipCount);

  const point = await anchorOf(page, map, "macro", code);
  await page.mouse.click(point.x, point.y);

  // Cây, dòng đếm, chú giải và bản đồ cùng chỉ còn mẫu của miền đó.
  await expect(page.getByText(`Đang hiện ${vi(inArea)} trong ${vi(data.tipCount)} mẫu`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__vietstrain!.stats!.tipsVisible)).toBe(inArea);
  await expect(page.getByText(`Địa bàn: ${name}`)).toBeVisible();
  await expect(page.locator(`.map__area[data-code="${code}"]`)).toHaveAttribute("aria-pressed", "true");
  const legend = await page.locator(".legend__count").allTextContents();
  const visibleInLegend = legend.map((text) => Number(text.split("/")[0].replace(/\D/g, "")));
  expect(visibleInLegend.reduce((sum, count) => sum + count, 0)).toBe(inArea);
  const filtered = await shownOnMap(page);
  for (const [other, total] of all.counts) {
    expect(filtered[other], other).toEqual([other === code ? total : 0, total]);
  }

  // Lọc thêm theo một genotype trong chú giải: số trên bản đồ là số mẫu của miền đó mang genotype đó.
  const genotype = data.clade.find(
    (value, tip) => value !== null && areaOf(map, "macro", data.unit[tip], data.region[tip]) === code,
  )!;
  const both = totals(map, "macro", data, (tip) => data.clade[tip] === genotype).counts.get(code)!;
  const label = page.locator(".legend__label").getByText(genotype, { exact: true });
  await page.locator(".legend__row").filter({ has: label }).click();
  await expect.poll(async () => (await shownOnMap(page))[code]).toEqual([both, inArea]);
  await expect(page.getByText(`Đang hiện ${vi(both)} trong ${vi(data.tipCount)} mẫu`)).toBeVisible();

  // Bỏ bộ lọc theo địa bàn: còn lại bộ lọc theo genotype, trên mọi miền.
  await page.getByRole("button", { name: "Bỏ lọc theo địa bàn" }).click();
  const byGenotype = totals(map, "macro", data, (tip) => data.clade[tip] === genotype);
  await expect.poll(async () => (await shownOnMap(page))[code]).toEqual([byGenotype.counts.get(code)!, inArea]);
  await expect(page.locator(`.map__area[data-code="${code}"]`)).toHaveAttribute("aria-pressed", "false");
});

test("selecting a province keeps its samples, in the old set and in the current one", async ({ page, request }) => {
  const data = await published(request);
  const map = await openMap(page);

  for (const level of ["vn63", "vn34"] as const) {
    await showLevel(page, level);
    // Tỉnh có nhiều mẫu nhất ở bộ này. Ở bộ 34, số của nó gồm cả mẫu của các tỉnh cũ gộp vào.
    const [code, inArea] = [...totals(map, level, data).counts].sort((a, b) => b[1] - a[1])[0];
    const name = map.levels[level].find((area) => area.code === code)!.vi;
    expect(inArea, level).toBeGreaterThan(0);

    const point = await anchorOf(page, map, level, code);
    await page.mouse.click(point.x, point.y);

    await expect(page.getByText(`Đang hiện ${vi(inArea)} trong ${vi(data.tipCount)} mẫu`), level).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__vietstrain!.stats!.tipsVisible), level).toBe(inArea);
    await expect(page.getByText(`Địa bàn: ${name}`), level).toBeVisible();
    await expect(page.locator(`.map__area[data-code="${code}"]`), level).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Bỏ lọc theo địa bàn" }).click();
    await expect(page.getByText(`Đang hiện ${vi(data.tipCount)} trong ${vi(data.tipCount)} mẫu`), level).toBeVisible();
  }
});

test("a filter set at one level stays when the map shows another level", async ({ page, request }) => {
  const data = await published(request);
  const map = await openMap(page);
  await showLevel(page, "macro");
  const [code] = [...totals(map, "macro", data).counts].sort((a, b) => b[1] - a[1])[0];
  const point = await anchorOf(page, map, "macro", code);
  await page.mouse.click(point.x, point.y);
  const context = page.locator(".map__outline--context");
  await expect(context).toHaveCount(0);

  await showLevel(page, "vn34");

  // Số của từng tỉnh giờ chỉ đếm mẫu thuộc miền đã chọn.
  const inMacro = (tip: number) => areaOf(map, "macro", data.unit[tip], data.region[tip]) === code;
  const expected = totals(map, "vn34", data, inMacro).counts;
  const whole = totals(map, "vn34", data).counts;
  expect(await shownOnMap(page)).toEqual(
    Object.fromEntries([...whole].map(([area, total]) => [area, [expected.get(area)!, total]])),
  );
  await expect(page.locator(".chips")).toContainText("Địa bàn:");
  // Miền đang lọc không có hình ở cấp tỉnh: đường bao của nó được vẽ nét đứt để người xem biết đang lọc theo đâu.
  await expect(context).toHaveCount(1);
  await expect(context).toHaveAttribute("d", map.levels.macro.find((area) => area.code === code)!.d);

  await page.getByRole("button", { name: "Bỏ lọc theo địa bàn" }).click();
  await expect(context).toHaveCount(0);
});

test("the 34 units count the samples of the provinces merged into them (criterion B4)", async ({ page, request }) => {
  const data = await published(request);
  const map = await openMap(page);
  await showLevel(page, "vn63");
  const old = await shownOnMap(page);
  await showLevel(page, "vn34");
  const current = await shownOnMap(page);

  for (const unit of map.levels.vn34) {
    const merged = map.levels.vn63.filter((province) => province.successor === unit.code);
    const fromOld = merged.reduce((sum, province) => sum + old[province.code][1], 0);
    const own = data.unit.filter((code) => code === unit.code).length;
    expect(merged.length, unit.code).toBeGreaterThan(0);
    expect(current[unit.code][1], unit.code).toBe(fromOld + own);
  }
  // Mẫu mang mã tỉnh nào cũng xếp được vào bộ 34; bộ 63 chỉ nhận mẫu mang mã tỉnh cũ.
  const sum = (shown: Record<string, [number, number]>) =>
    Object.values(shown).reduce((total, pair) => total + pair[1], 0);
  expect(sum(current)).toBe(data.unit.filter((code) => code !== null).length);
  expect(sum(old)).toBe(data.unit.filter((code) => code?.startsWith("vn63:")).length);
});

test("Hoàng Sa and Trường Sa are on the map at every level, with their names (criterion B6)", async ({ page }) => {
  const map = await openMap(page);
  const owners: Record<Level, string[]> = {
    macro: ["vnm:central"],
    region: ["vnr:north-central-and-central-coast"],
    vn34: ["vn34:da-nang", "vn34:khanh-hoa"],
    vn63: ["vn63:da-nang", "vn63:khanh-hoa"],
  };

  for (const level of LEVELS) {
    await showLevel(page, level);
    for (const name of ["Quần đảo Hoàng Sa", "Quần đảo Trường Sa"]) {
      await expect(page.locator(".map__label", { hasText: name }), `${name}, ${level}`).toBeVisible();
    }
    // Các chấm đảo thuộc đúng địa bàn sở hữu chúng, và chỉ các địa bàn đó.
    const withDots = await page
      .locator(".map__area:has(.map__dots)")
      .evaluateAll((all) => all.map((one) => one.getAttribute("data-code")));
    expect(withDots, level).toEqual(owners[level]);
    expect(
      map.levels[level].filter((area) => area.dots).map((area) => area.code),
      level,
    ).toEqual(owners[level]);
  }
});

test("an area can be reached and selected from the keyboard, and says its name and count (criterion B8)", async ({
  page,
  request,
}) => {
  const data = await published(request);
  const map = await openMap(page);
  await showLevel(page, "macro");
  const all = totals(map, "macro", data).counts;
  const [code, inArea] = [...all].sort((a, b) => b[1] - a[1])[0];
  const area = page.locator(`.map__area[data-code="${code}"]`);
  const name = map.levels.macro.find((candidate) => candidate.code === code)!.vi;

  await expect(area).toHaveAttribute("role", "button");
  await expect(area).toHaveAttribute("tabindex", "0");
  await expect(area).toHaveAttribute("aria-label", `${name}: ${vi(inArea)} mẫu`);

  // Địa bàn không có mẫu thì không có gì để lọc: nó không nằm trong thứ tự Tab. Ở cấp tỉnh, phần lớn tỉnh là vậy.
  await showLevel(page, "vn63");
  const provinces = totals(map, "vn63", data).counts;
  const withSamples = [...provinces].filter(([, count]) => count > 0).map(([province]) => province);
  expect(withSamples.length).toBeLessThan(provinces.size);
  const reachable = await page
    .locator(".map__area[tabindex]")
    .evaluateAll((all) => all.map((one) => one.getAttribute("data-code")));
  expect(reachable).toEqual(withSamples);
  await showLevel(page, "macro");

  await area.focus();
  await expect(page.locator(".map__figure .tooltip")).toContainText(name);
  await page.keyboard.press("Enter");
  await expect(area).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(`Đang hiện ${vi(inArea)} trong ${vi(data.tipCount)} mẫu`)).toBeVisible();

  await page.keyboard.press("Space");
  await expect(area).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(`Đang hiện ${vi(data.tipCount)} trong ${vi(data.tipCount)} mẫu`)).toBeVisible();

  // Danh sách bên dưới là đường thứ hai tới cùng bộ lọc.
  await page.locator(".map__row", { hasText: name }).click();
  await expect(area).toHaveAttribute("aria-pressed", "true");
});

test("pointing at an area shows its name and how many of its samples are shown", async ({ page, request }) => {
  const data = await published(request);
  const map = await openMap(page);
  await showLevel(page, "vn63");
  const all = totals(map, "vn63", data).counts;
  const [code, inArea] = [...all].sort((a, b) => b[1] - a[1])[0];
  const [emptyCode] = [...all].find(([, count]) => count === 0)!;
  const nameOf = (wanted: string) => map.levels.vn63.find((area) => area.code === wanted)!.vi;
  const tooltip = page.locator(".map__figure .tooltip");

  let point = await anchorOf(page, map, "vn63", code);
  await page.mouse.move(point.x, point.y);
  await expect(tooltip).toContainText(nameOf(code));
  await expect(tooltip).toContainText(`${vi(inArea)} mẫu`);

  point = await anchorOf(page, map, "vn63", emptyCode);
  await page.mouse.move(point.x, point.y);
  await expect(tooltip).toContainText(nameOf(emptyCode));
  await expect(tooltip).toContainText("Không có mẫu");
});

test("the map can be hidden; a filter set on it stays and the tree takes the room", async ({ page, request }) => {
  const data = await published(request);
  const map = await openMap(page);
  await showLevel(page, "macro");
  const [code, inArea] = [...totals(map, "macro", data).counts].sort((a, b) => b[1] - a[1])[0];
  const point = await anchorOf(page, map, "macro", code);
  await page.mouse.click(point.x, point.y);
  const canvas = page.getByRole("img", { name: /Cây phát sinh loài/ });
  const narrow = (await canvas.boundingBox())!.width;

  await page.locator(".sidebar").getByText("Ẩn", { exact: true }).click();

  await expect(page.locator(".map")).toHaveCount(0);
  await expect(page.getByText(`Đang hiện ${vi(inArea)} trong ${vi(data.tipCount)} mẫu`)).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(narrow + 200);

  await page.locator(".sidebar").getByText("Hiện", { exact: true }).click();
  await expect(page.locator(`.map__area[data-code="${code}"]`)).toHaveAttribute("aria-pressed", "true");
});

test("the map waits for its place columns, and never shows a level it then leaves", async ({ page, request }) => {
  const data = await published(request);
  // Ghi lại mọi cấp mà bản đồ từng hiện, kể từ lúc trang mở.
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __levelsSeen: seen });
    new MutationObserver(() => {
      const level = document.querySelector(".map__svg")?.getAttribute("data-level");
      if (level && seen.at(-1) !== level) seen.push(level);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-level"] });
  });
  // Cột vùng về chậm hơn mọi thứ khác: hình học và cây đã xong từ lâu.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/col.region.json", async (route) => {
    await held;
    await route.continue();
  });
  const asset = page.waitForResponse((response) => /vn-map-/.test(response.url()));
  await openTree(page);
  const map: MapFile = await (await asset).json();

  // Chưa có cột vùng thì chưa biết mẫu nằm ở đâu: bản đồ chưa vẽ, và nói là đang tải.
  await expect(page.locator(".map")).toContainText("Đang tải bản đồ");
  await expect(page.locator(".map__svg")).toHaveCount(0);

  release();

  const opening = (["vn34", "region", "macro"] as const).find((level) => {
    const { home, placed } = totals(map, level, data);
    return placed * 2 >= home;
  })!;
  await expect(page.locator(".map__svg")).toHaveAttribute("data-level", opening);
  expect(await page.evaluate(() => (window as unknown as { __levelsSeen: string[] }).__levelsSeen)).toEqual([opening]);
});

test("a place column that fails to load is reported on the map and can be loaded again", async ({ page, request }) => {
  const data = await published(request);
  let failures = 0;
  await page.route("**/col.region.json", async (route) => {
    // Lần tải đầu bị cắt giữa chừng; các lần sau đi bình thường.
    if (failures === 0) {
      failures++;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  const asset = page.waitForResponse((response) => /vn-map-/.test(response.url()));
  await openTree(page);
  const map: MapFile = await (await asset).json();

  const notice = page.locator(".map").getByRole("alert");
  await expect(notice).toContainText("Không tải được dữ liệu địa bàn");
  await expect(page.locator(".map__svg")).toHaveCount(0);
  expect(await page.evaluate(() => window.__vietstrain!.stats!.tipsVisible)).toBeGreaterThan(0);

  await notice.getByRole("button", { name: "Thử lại" }).click();

  await showLevel(page, "macro");
  const expected = totals(map, "macro", data).counts;
  expect(await shownOnMap(page)).toEqual(
    Object.fromEntries([...expected].map(([code, count]) => [code, [count, count]])),
  );
  await expect(notice).toHaveCount(0);
  expect(failures).toBe(1);
});

test("a map that fails to load is reported and can be loaded again, and the tree keeps working", async ({ page }) => {
  let failures = 0;
  await page.route("**/assets/vn-map-*.json", async (route) => {
    // Lần tải đầu bị cắt giữa chừng; các lần sau đi bình thường.
    if (failures === 0) {
      failures++;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await openTree(page);

  const notice = page.locator(".map").getByRole("alert");
  await expect(notice).toContainText("Không tải được bản đồ");
  expect(await page.evaluate(() => window.__vietstrain!.stats!.tipsVisible)).toBeGreaterThan(0);

  await notice.getByRole("button", { name: "Thử lại" }).click();

  await expect(page.locator(".map__svg")).toBeVisible();
  await expect(notice).toHaveCount(0);
  expect(failures).toBe(1);
});

test("a dataset without place columns has no map and no switch for it", async ({ page }) => {
  await page.route("**/manifest.json", async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    manifest.columns = manifest.columns.filter((column: { key: string }) => !["unit", "region"].includes(column.key));
    await route.fulfill({ response, json: manifest });
  });
  let mapRequests = 0;
  page.on("request", (request) => {
    if (/vn-map-/.test(request.url())) mapRequests++;
  });
  await openTree(page);

  await expect(page.getByLabel("Tô màu theo")).toBeVisible();
  await expect(page.locator(".map")).toHaveCount(0);
  await expect(page.locator(".sidebar").getByText("Bản đồ", { exact: true })).toHaveCount(0);
  expect(mapRequests).toBe(0);
});

test("the dataset list does not load the map", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bộ dữ liệu" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(requests.filter((path) => /vn-map-/.test(path))).toEqual([]);
});
