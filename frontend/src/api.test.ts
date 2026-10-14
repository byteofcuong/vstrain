import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getMe, logIn, logOut, submitSample } from "./api";

const USER = { email: "lab@example.org", displayName: "Phòng xét nghiệm A", role: "submitter" };

/** Thay `fetch` bằng một hàm trả lời sẵn, và ghi lại nó đã được gọi thế nào. */
function answer(status: number, body?: unknown) {
  const fetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => {
    const text = body === undefined ? null : JSON.stringify(body);
    return new Response(text, { status, headers: text === null ? {} : { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("logIn", () => {
  it("posts the credentials as JSON with the header every write request must carry", async () => {
    const fetch = answer(200, { user: USER });

    const user = await logIn("lab@example.org", "mật khẩu đủ dài");

    expect(user).toEqual(USER);
    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe("/api/auth/login");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ email: "lab@example.org", password: "mật khẩu đủ dài" });
    const headers = new Headers(init?.headers);
    // Backend từ chối mọi request ghi thiếu header này (chống trang khác mượn cookie).
    expect(headers.get("X-Requested-With")).not.toBeNull();
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("fails with the code the server gave, so the page can say what happened", async () => {
    answer(401, { error: { code: "INVALID_CREDENTIALS", message: "Wrong email or password" } });

    const error = await logIn("lab@example.org", "sai").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });

  it("still fails cleanly when the answer is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" })),
    );

    const error = await logIn("lab@example.org", "x").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 502, code: "HTTP_ERROR" });
  });
});

describe("submitSample", () => {
  const SAMPLE = { displayName: "Mẫu", collectionDate: "2024", unitCode: "vn63:ha-noi", host: null, fasta: ">a\nACGT" };

  it("keeps the fields a refusal carries besides its code, so the form can name the identical samples", async () => {
    const matches = [
      { displayName: "Mẫu cũ", source: "submission", mine: true, internalId: "S0000001", accession: null },
    ];
    answer(409, { error: { code: "IDENTICAL_SEQUENCE", message: "Identical", matches, matchCount: 1 } });

    const error = await submitSample(SAMPLE).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 409, code: "IDENTICAL_SEQUENCE", extra: { matches, matchCount: 1 } });
    expect((error as ApiError).extra).not.toHaveProperty("code");
  });

  it("says the lab has confirmed another sample only when asked to", async () => {
    const fetch = answer(201, {});

    await submitSample(SAMPLE);
    await submitSample(SAMPLE, { allowIdentical: true });

    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(init?.body as string));
    expect(bodies[0]).toEqual(SAMPLE);
    expect(bodies[1]).toEqual({ ...SAMPLE, allowIdentical: true });
  });
});

describe("logOut", () => {
  it("posts with the write header and accepts an empty answer", async () => {
    const fetch = answer(204);

    await expect(logOut()).resolves.toBeUndefined();

    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe("/api/auth/logout");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-Requested-With")).not.toBeNull();
  });
});

describe("getMe", () => {
  it("returns the user who is logged in", async () => {
    const fetch = answer(200, { user: USER });

    expect(await getMe()).toEqual(USER);
    // Endpoint này trả 200 cả cho khách, nên trình duyệt không ghi một dòng lỗi mỗi lần trang mở.
    expect(fetch.mock.calls[0][0]).toBe("/api/auth/session");
  });

  it("returns null for a guest, which is not an error", async () => {
    answer(200, { user: null });

    expect(await getMe()).toBeNull();
  });

  it("fails when the server itself fails, instead of calling everyone a guest", async () => {
    answer(500, { error: { code: "INTERNAL_ERROR", message: "The server could not handle this request" } });

    await expect(getMe()).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});
