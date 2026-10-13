import type { AdminUnit, JobCounts, JobStatus } from "../api";
import { translate, type Lang, type MessageKey } from "../i18n";

/** Phần tính toán của các trang quản trị, tách khỏi component để thử được mà không cần trình duyệt. */

const UNITS = {
  vi: { second: "giây", minute: "phút", hour: "giờ" },
  en: { second: "s", minute: "min", hour: "h" },
} as const;

const two = (value: number) => String(value).padStart(2, "0");

/** Một khoảng thời gian tính bằng giây, viết theo đơn vị người đọc quen: "0,4 giây", "6 phút 53 giây", "1 giờ 02 phút". */
export function duration(seconds: number, lang: Lang): string {
  const unit = UNITS[lang];
  const tenths = Math.round(seconds * 10) / 10;
  if (tenths < 10 && tenths !== Math.round(tenths)) {
    return `${tenths.toFixed(1).replace(".", lang === "vi" ? "," : ".")} ${unit.second}`;
  }
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} ${unit.second}`;
  if (whole < 3600) return `${Math.floor(whole / 60)} ${unit.minute} ${two(whole % 60)} ${unit.second}`;
  return `${Math.floor(whole / 3600)} ${unit.hour} ${two(Math.floor((whole % 3600) / 60))} ${unit.minute}`;
}

/** Một thời điểm theo giờ của máy người xem, viết gọn. */
export function when(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

const INTERVAL_PRESETS = [6, 12, 24, 72, 168];

/** Các khoảng cách (giờ) để chọn cho lịch build; khoảng đang đặt được thêm vào nếu nó không nằm trong số đó. */
export function intervalOptions(current: number | null): number[] {
  const options = new Set(INTERVAL_PRESETS);
  if (current !== null) options.add(current);
  return [...options].sort((a, b) => a - b);
}

export function intervalLabel(hours: number | null): { key: MessageKey; values?: Record<string, number> } {
  if (hours === null) return { key: "scheduleOff" };
  if (hours === 24) return { key: "scheduleDaily" };
  if (hours === 168) return { key: "scheduleWeekly" };
  if (hours % 24 === 0) return { key: "scheduleEveryDays", values: { count: hours / 24 } };
  return { key: "scheduleEveryHours", values: { count: hours } };
}

const JOB_KINDS: ReadonlyMap<string, MessageKey> = new Map([
  ["align_pending", "jobKind_align_pending"],
  ["build_dataset", "jobKind_build_dataset"],
  ["ingest_sample", "jobKind_ingest_sample"],
  ["place_pending", "jobKind_place_pending"],
  ["publish_build", "jobKind_publish_build"],
  ["tool_versions", "jobKind_tool_versions"],
]);

/** Tên của một loại job; loại mà giao diện chưa biết (server mới hơn) hiện bằng chính tên của nó. */
export function jobKindLabel(kind: string, lang: Lang): string {
  const key = JOB_KINDS.get(kind);
  return key ? translate(lang, key) : kind;
}

const SUBJECT_CHARS = 60;

/** Thứ một job làm việc trên đó, đọc từ tham số của nó: slug của dataset, mã mẫu, mã build, hay lineage. */
export function jobSubject(params: Record<string, unknown>): string {
  const text = (value: unknown, prefix = "") =>
    typeof value === "string" || typeof value === "number" ? `${prefix}${value}`.slice(0, SUBJECT_CHARS) : "";
  return text(params.dataset) || text(params.sample_id, "#") || text(params.build_id, "build ") || text(params.lineage);
}

export function queueIsBusy(counts: JobCounts): boolean {
  return counts.queued + counts.running > 0;
}

/**
 * Việc admin làm được với một job: huỷ khi nó chưa kết thúc; chạy lại khi nó hỏng hoặc bị huỷ và chưa được chạy lại
 * (`retriedBy` là mã của job chạy lại, nếu có).
 */
export function jobActions(status: JobStatus, retriedBy: number | null): { cancel: boolean; retry: boolean } {
  return {
    cancel: status === "queued" || status === "running",
    retry: (status === "failed" || status === "cancelled") && retriedBy === null,
  };
}

const ADMIN_ERRORS: ReadonlyMap<string, MessageKey> = new Map([
  ["JOB_NOT_FAILED", "adminError_JOB_NOT_FAILED"],
  ["JOB_ALREADY_RETRIED", "adminError_JOB_ALREADY_RETRIED"],
  ["JOB_ALREADY_FINISHED", "adminError_JOB_ALREADY_FINISHED"],
  ["BUILD_ALREADY_WAITING", "adminError_BUILD_ALREADY_WAITING"],
  ["ALIAS_EXISTS", "adminError_ALIAS_EXISTS"],
  ["EMPTY_PLACE", "adminError_EMPTY_PLACE"],
  ["PLACE_TOO_LONG", "adminError_PLACE_TOO_LONG"],
  ["UNKNOWN_UNIT", "adminError_UNKNOWN_UNIT"],
  ["SEED_ALIAS", "adminError_SEED_ALIAS"],
  ["FORBIDDEN", "adminError_FORBIDDEN"],
  ["EMAIL_TAKEN", "adminError_EMAIL_TAKEN"],
  ["CANNOT_LOCK_SELF", "adminError_CANNOT_LOCK_SELF"],
  ["USE_OWN_PASSWORD_FORM", "adminError_USE_OWN_PASSWORD_FORM"],
  ["USER_NOT_FOUND", "adminError_USER_NOT_FOUND"],
]);

/** Lời báo cho một lần bị API vận hành từ chối; mã chưa biết dùng lời chung. */
export function adminErrorMessage(code: string): MessageKey {
  return ADMIN_ERRORS.get(code) ?? "actionFailed";
}

export interface UnitGroup {
  label: MessageKey;
  units: { code: string; name: string }[];
}

/** Các đơn vị mà một cách viết địa danh có thể được gán vào, chia nhóm, nhóm cụ thể nhất trước. */
export function unitGroups(units: readonly AdminUnit[], lang: Lang): UnitGroup[] {
  const compare = new Intl.Collator(lang === "vi" ? "vi" : "en").compare;
  const group = (label: MessageKey, belongs: (unit: AdminUnit) => boolean): UnitGroup => ({
    label,
    units: units
      .filter(belongs)
      .map((unit) => ({ code: unit.code, name: lang === "vi" ? unit.nameVi : unit.nameEn }))
      .sort((a, b) => compare(a.name, b.name)),
  });
  return [
    group("unitsOf63", (unit) => unit.level === "province" && unit.unitSet === "vn63"),
    group("unitsOf34", (unit) => unit.level === "province" && unit.unitSet === "vn34"),
    group("unitsRegions", (unit) => unit.level === "region"),
    group("unitsMacroRegions", (unit) => unit.level === "macro_region"),
  ].filter((one) => one.units.length > 0);
}
