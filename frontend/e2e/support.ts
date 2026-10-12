import type { APIRequestContext, Page } from "@playwright/test";

/** Dataset mà các test đầu-cuối mở: build DENV1 thật. */
export const SLUG = "dengue-denv1";

/** `col.<key>.json` của bản publish: cột mã hoá từ điển. */
export interface ColumnFile {
  values: string[];
  labels?: string[];
  codes: number[];
}

/** Hàm đọc một file JSON trong thư mục publish của build hiện hành. */
export async function publishedFiles(request: APIRequestContext): Promise<<T>(name: string) => Promise<T>> {
  const datasets = await (await request.get("/api/datasets?limit=500")).json();
  const dataset = datasets.items.find((item: { slug: string }) => item.slug === SLUG);
  const manifestUrl: string = dataset.currentBuild.manifestUrl;
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
  return async (name) => (await request.get(base + name)).json();
}

/** Mở trang của dataset và chờ tới khi cây đã vẽ khung hình đầu. */
export async function openTree(page: Page): Promise<void> {
  await page.goto(`/#/d/${SLUG}`);
  await page.waitForFunction(() => (window.__vietstrain?.frames ?? 0) > 0 && window.__vietstrain!.stats !== null);
}

/** Số viết theo kiểu tiếng Việt, như giao diện hiện: 1.964. */
export const vi = (value: number) => new Intl.NumberFormat("vi-VN").format(value);
