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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    // Lỗi của API có dạng {"error": {"code", "message"}}; thứ khác (proxy, mất mạng) thì không.
    const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(response.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? response.statusText);
  }
  return (await response.json()) as T;
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
