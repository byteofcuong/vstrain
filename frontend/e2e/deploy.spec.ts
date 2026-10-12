import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Kiểm tra service `web` (nginx) của bản triển khai: nó phát frontend đã build và các bản publish, và chuyển
 * `/api` sang backend. Chỉ chạy với `npm run e2e:web`, khi `docker compose -f deploy/docker-compose.yml up -d`
 * đã bật service `web` ở cổng 8080 và `npm run build` đã chạy.
 */
const IMMUTABLE = "public, max-age=31536000, immutable";

async function manifestUrlOf(request: APIRequestContext): Promise<string> {
  const dataset = await (await request.get("/api/datasets/dengue-denv1")).json();
  return dataset.currentBuild.manifestUrl;
}

test("the page comes with security headers and is checked again on every visit", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();

  expect(response.status()).toBe(200);
  expect(headers["content-type"]).toContain("text/html");
  // Trang nhỏ và trỏ tới các file có hash trong tên: trình duyệt phải hỏi lại để thấy bản build mới.
  expect(headers["cache-control"]).toBe("no-cache");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-security-policy"]).toBe(
    "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  expect(headers["referrer-policy"]).toBe("no-referrer");
  // Không để lộ số phiên bản của nginx.
  expect(headers["server"]).toBe("nginx");
});

test("the script of the page is compressed and kept by the browser for good", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(script, "index.html names a script under /assets/").toBeDefined();

  const response = await request.get(script!);

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe(IMMUTABLE);
  expect(response.headers()["content-encoding"]).toBe("gzip");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the API answers on the same origin and is not marked as cacheable", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", db: "ok" });
  expect(response.headers()["cache-control"]).toBeUndefined();
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("published files are compressed and never change", async ({ request }) => {
  const manifestUrl = await manifestUrlOf(request);
  const manifestResponse = await request.get(manifestUrl);
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["cache-control"]).toBe(IMMUTABLE);
  const manifest = await manifestResponse.json();

  const tree = await request.get(manifestUrl.replace(/[^/]+$/, manifest.files.tree.path));

  expect(tree.status()).toBe(200);
  expect(tree.headers()["content-type"]).toContain("application/json");
  expect(tree.headers()["cache-control"]).toBe(IMMUTABLE);
  expect(tree.headers()["content-encoding"]).toBe("gzip");
  // Nội dung sau khi giải nén vẫn là đúng file đã publish.
  expect((await tree.json()).tipCount).toBe(manifest.counts.tips);
});

test("nothing but the page, its assets, published files and the API can be fetched", async ({ request }) => {
  const manifestUrl = await manifestUrlOf(request);
  // "/builds/<slug>/b<mã build>": thư mục của build, chứa cả file trung gian nằm ngoài thư mục publish.
  const buildDirectory = manifestUrl.split("/").slice(0, 4).join("/");

  for (const path of [
    `${buildDirectory}/auspice.json`,
    `${buildDirectory}/`,
    "/builds/",
    "/builds/dengue-denv1/",
    manifestUrl.replace("manifest.json", ""),
    manifestUrl.replace("manifest.json", "khong-co.json"),
    "/assets/",
    "/assets/khong-co.js",
    "/index.html",
    "/khong-co",
    "/.env",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    // Trang lỗi không được trình duyệt giữ lại như một file không bao giờ đổi, và vẫn mang header bảo mật.
    expect(response.headers()["cache-control"], path).toBeUndefined();
    expect(response.headers()["x-content-type-options"], path).toBe("nosniff");
  }
});
