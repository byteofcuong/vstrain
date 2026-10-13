import type { ProvisionalTip } from "./tree/provisional";

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
  /** Số giờ giữa hai lần build tự động; `null` là không có lịch. */
  buildIntervalHours: number | null;
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

/** Tài khoản đang đăng nhập, như `GET /api/auth/session` trả về. */
export interface User {
  email: string;
  displayName: string;
  role: "submitter" | "admin";
}

/** Một lỗi gắn với một trường của request. `code` có ở những lỗi mà giao diện dịch được; không có thì dùng `message`. */
export interface FieldProblem {
  field: string;
  code?: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: FieldProblem[] = [],
  ) {
    super(message);
  }
}

/** Biến một câu trả lời lỗi thành `ApiError`. */
async function failure(response: Response): Promise<ApiError> {
  // Lỗi của API có dạng {"error": {"code", "message"}}; thứ khác (proxy, mất mạng) thì không.
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: FieldProblem[] };
  } | null;
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  return new ApiError(
    response.status,
    body?.error?.code ?? "HTTP_ERROR",
    body?.error?.message ?? response.statusText,
    details,
  );
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

/**
 * Tài khoản đang đăng nhập, hoặc `null` với khách. Server trả 200 cho cả hai, nên trình duyệt không ghi dòng lỗi
 * nào khi một người khách mở trang. Lỗi của server vẫn là lỗi, không coi là khách.
 */
export async function getMe(signal?: AbortSignal): Promise<User | null> {
  return (await get<{ user: User | null }>("/api/auth/session", signal)).user;
}

export async function logIn(email: string, password: string): Promise<User> {
  return (await send<{ user: User }>("POST", "/api/auth/login", { email, password })).user;
}

export function logOut(): Promise<void> {
  return send<void>("POST", "/api/auth/logout");
}

/** Một đơn vị hành chính, kèm thời gian hiệu lực (bộ 63 tỉnh tới 2025-06-30, bộ 34 đơn vị từ 2025-07-01). */
export interface AdminUnit {
  code: string;
  level: "macro_region" | "region" | "province";
  unitSet: "vn63" | "vn34" | null;
  nameVi: string;
  nameEn: string;
  parentCode: string | null;
  successorCode: string | null;
  validFrom: string | null;
  validTo: string | null;
}

export async function listProvinces(signal?: AbortSignal): Promise<AdminUnit[]> {
  return (await get<{ items: AdminUnit[] }>("/api/units?level=province", signal)).items;
}

/** Thứ form nộp mẫu gửi đi. `collectionDate` là "YYYY", "YYYY-MM" hoặc "YYYY-MM-DD"; `fasta` là nội dung file. */
export interface SubmissionInput {
  displayName: string;
  collectionDate: string;
  unitCode: string;
  host: string | null;
  fasta: string;
}

/** Mẫu đang ở đâu trên đường từ lúc nộp tới cây. */
export type SubmissionStage =
  "processing" | "failed" | "rejected" | "hidden" | "accepted" | "placement_failed" | "placed" | "in_tree";

export interface Submission {
  internalId: string;
  displayName: string;
  collectionDate: string | null;
  unitCode: string | null;
  host: string | null;
  status: string;
  stage: SubmissionStage;
  rejectCode: string | null;
  rejectMessage: string | null;
  lineage: string | null;
  coverage: number | null;
  validNt: number | null;
  sequenceLength: number | null;
  submittedAt: string;
  submitterName: string;
  /** Dataset mà build hiện hành đã có mẫu này như một tip chính thức. */
  inDatasets: { dataset: string; title: string }[];
  /** Dataset mà mẫu đang là tip tạm trên cây của build hiện hành. */
  placements: { dataset: string; title: string; clade: string | null; privateMutations: number }[];
}

export interface SubmissionPage {
  items: Submission[];
  total: number;
  limit: number;
  offset: number;
}

export function submitSample(input: SubmissionInput): Promise<Submission> {
  return send<Submission>("POST", "/api/submissions", input);
}

/** Thứ form sửa mẫu gửi đi: các trường người nộp khai, không có chuỗi. */
export type CorrectionInput = Omit<SubmissionInput, "fasta">;

export function getSubmission(internalId: string, signal?: AbortSignal): Promise<Submission> {
  return get<Submission>(`/api/submissions/${encodeURIComponent(internalId)}`, signal);
}

export function correctSubmission(internalId: string, input: CorrectionInput): Promise<Submission> {
  return send<Submission>("PATCH", `/api/submissions/${encodeURIComponent(internalId)}`, input);
}

export function listSubmissions(scope: "mine" | "all", signal?: AbortSignal): Promise<SubmissionPage> {
  return get<SubmissionPage>(`/api/submissions?scope=${scope}&limit=200`, signal);
}

/** Các tip tạm của một dataset. Chỉ số node chỉ có nghĩa với cây của build mang mã `buildId`. */
export interface Placements {
  buildId: number | null;
  items: (ProvisionalTip & { placedAt: string })[];
}

export function getPlacements(slug: string, signal?: AbortSignal): Promise<Placements> {
  return get<Placements>(`/api/datasets/${encodeURIComponent(slug)}/placements`, signal);
}

/** Ẩn hoặc hiện lại một mẫu (chỉ admin). */
export function setSampleHidden(internalId: string, hidden: boolean): Promise<void> {
  return send<void>("POST", `/api/admin/samples/${encodeURIComponent(internalId)}/${hidden ? "hide" : "unhide"}`);
}

// --- Vận hành (chỉ admin) ---

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: number;
  kind: string;
  status: JobStatus;
  params: Record<string, unknown>;
  priority: number;
  worker: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Thời gian chạy của job đã kết thúc. */
  seconds: number | null;
  /** Trong danh sách: dòng đầu của lỗi; ở chi tiết: đầy đủ. */
  error: string | null;
  retryOf: number | null;
}

export interface JobStep {
  position: number;
  name: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  seconds: number | null;
  logTail: string | null;
}

export interface JobDetail extends Job {
  result: Record<string, unknown> | null;
  retriedBy: number | null;
  steps: JobStep[];
}

export type JobCounts = Record<JobStatus, number>;

export interface JobPage {
  items: Job[];
  total: number;
  /** Của cả hàng đợi, không theo bộ lọc. */
  counts: JobCounts;
  oldestQueuedSeconds: number | null;
}

export function listJobs(status: JobStatus | null, signal?: AbortSignal): Promise<JobPage> {
  return get<JobPage>(`/api/admin/jobs?limit=100${status ? `&status=${status}` : ""}`, signal);
}

export function getJob(id: number, signal?: AbortSignal): Promise<JobDetail> {
  return get<JobDetail>(`/api/admin/jobs/${id}`, signal);
}

/** Chạy lại một job hỏng; trả về mã của job mới. */
export async function retryJob(id: number): Promise<number> {
  return (await send<{ id: number }>("POST", `/api/admin/jobs/${id}/retry`)).id;
}

/** Huỷ một job đang chờ hoặc đang chạy; trả về job với tình trạng mới. */
export function cancelJob(id: number): Promise<Job> {
  return send<Job>("POST", `/api/admin/jobs/${id}/cancel`);
}

export async function setBuildInterval(slug: string, hours: number | null): Promise<number | null> {
  const path = `/api/admin/datasets/${encodeURIComponent(slug)}`;
  return (await send<{ buildIntervalHours: number | null }>("PATCH", path, { buildIntervalHours: hours }))
    .buildIntervalHours;
}

/** Xếp một lần dựng cây ngay; trả về mã job. */
export async function requestBuild(slug: string): Promise<number> {
  return (await send<{ id: number }>("POST", `/api/admin/datasets/${encodeURIComponent(slug)}/builds`)).id;
}

export async function listUnits(signal?: AbortSignal): Promise<AdminUnit[]> {
  return (await get<{ items: AdminUnit[] }>("/api/units", signal)).items;
}

/** Một cách viết địa danh chưa khớp được với đơn vị nào. */
export interface UnresolvedPlace {
  key: string;
  text: string;
  spellings: string[];
  samples: number;
}

export interface UnresolvedPlaces {
  items: UnresolvedPlace[];
  samples: number;
}

export interface PlaceAlias {
  key: string;
  text: string;
  unitCode: string;
  unitName: string;
}

/** Kết quả của việc thêm hoặc xoá một tên thay thế: bao nhiêu mẫu đổi, cây của dataset nào được publish lại. */
export interface AliasChange {
  key: string;
  changedSamples: number;
  republished: string[];
}

export function listUnresolvedPlaces(signal?: AbortSignal): Promise<UnresolvedPlaces> {
  return get<UnresolvedPlaces>("/api/admin/places/unresolved", signal);
}

export async function listAliases(signal?: AbortSignal): Promise<PlaceAlias[]> {
  return (await get<{ items: PlaceAlias[] }>("/api/admin/places/aliases", signal)).items;
}

export function addAlias(text: string, unitCode: string): Promise<AliasChange> {
  return send<AliasChange>("POST", "/api/admin/places/aliases", { text, unitCode });
}

export function removeAlias(key: string): Promise<AliasChange> {
  return send<AliasChange>("DELETE", `/api/admin/places/aliases/${encodeURIComponent(key)}`);
}

/** Một tài khoản như admin thấy nó. */
export interface Account {
  id: number;
  email: string;
  displayName: string;
  role: "submitter" | "admin";
  isLocked: boolean;
  createdAt: string;
}

export interface AccountInput {
  email: string;
  displayName: string;
  role: "submitter" | "admin";
  password: string;
}

/** Đổi mật khẩu của chính mình; server đòi mật khẩu hiện tại và kết thúc các phiên khác của tài khoản. */
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return send<void>("POST", "/api/auth/password", { currentPassword, newPassword });
}

export async function listAccounts(signal?: AbortSignal): Promise<Account[]> {
  return (await get<{ items: Account[] }>("/api/admin/users", signal)).items;
}

export function createAccount(input: AccountInput): Promise<Account> {
  return send<Account>("POST", "/api/admin/users", input);
}

export function setAccountLocked(id: number, locked: boolean): Promise<void> {
  return send<void>("POST", `/api/admin/users/${id}/${locked ? "lock" : "unlock"}`);
}

export function resetAccountPassword(id: number, password: string): Promise<void> {
  return send<void>("POST", `/api/admin/users/${id}/password`, { password });
}
