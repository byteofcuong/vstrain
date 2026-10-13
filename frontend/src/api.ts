/** Các lời gọi tới API của backend. Kiểu dữ liệu theo hợp đồng trong các file `schemas.py` và `api.py` của backend. */

export interface CurrentBuild {
  id: number;
  sampleCount: number | null;
  publishedAt: string | null;
  contentHash: string | null;
  manifestUrl: string;
}

export interface DatasetInfo {
  slug: string;
  title: string;
  pathogen: string;
  lineage: string;
  maxSamples: number;
  currentBuild: CurrentBuild | null;
}

export interface SampleDetail {
  internalId: string;
  displayName: string;
  accession: string | null;
  pathogen: string;
  source: string;
  collectionDate: string | null;
  country: string | null;
  division: string | null;
  location: string | null;
  unitCode: string | null;
  regionCode: string | null;
  geoStatus: string;
  host: string | null;
  sequenceLength: number | null;
  meta: Record<string, unknown>;
}

/** Tài khoản đang đăng nhập, như `GET /api/auth/me` trả về. */
export interface User {
  email: string;
  displayName: string;
  role: "submitter" | "admin";
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Biến một câu trả lời lỗi thành `ApiError`. */
async function failure(response: Response): Promise<ApiError> {
  // Lỗi của API có dạng {"error": {"code", "message"}}; thứ khác (proxy, mất mạng) thì không.
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  return new ApiError(response.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? response.statusText);
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/**
 * Một request ghi. Mọi request ghi đi qua đây để mang header `X-Requested-With`: backend từ chối request ghi
 * thiếu nó, vì một trang khác không gắn được header tự đặt khi mượn cookie của người dùng.
 */
async function send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Requested-With": "vietstrain" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  // 204: không có nội dung để đọc.
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function listDatasets(signal?: AbortSignal): Promise<DatasetInfo[]> {
  const page = await get<{ items: DatasetInfo[] }>("/api/datasets?limit=500", signal);
  return page.items;
}

export function getDataset(slug: string, signal?: AbortSignal): Promise<DatasetInfo> {
  return get<DatasetInfo>(`/api/datasets/${encodeURIComponent(slug)}`, signal);
}

export function getSample(internalId: string, signal?: AbortSignal): Promise<SampleDetail> {
  return get<SampleDetail>(`/api/samples/${encodeURIComponent(internalId)}`, signal);
}

/** Tài khoản đang đăng nhập, hoặc `null` với khách. Lỗi khác của server vẫn là lỗi, không coi là khách. */
export async function getMe(signal?: AbortSignal): Promise<User | null> {
  try {
    return (await get<{ user: User }>("/api/auth/me", signal)).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function logIn(email: string, password: string): Promise<User> {
  return (await send<{ user: User }>("POST", "/api/auth/login", { email, password })).user;
}

export function logOut(): Promise<void> {
  return send<void>("POST", "/api/auth/logout");
}
