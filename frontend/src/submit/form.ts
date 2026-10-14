import type { AdminUnit, ApiError, Submission, SubmissionStage } from "../api";
import type { MessageKey } from "../i18n";

/**
 * Phần logic của form nộp mẫu, tách khỏi giao diện để thử được. Server vẫn kiểm tra lại mọi thứ; phần này chỉ để
 * form giúp người nộp chọn đúng ngay từ đầu.
 */

/** Giới hạn cỡ file của server (xem `validate.py`); form báo ngay thay vì gửi 2 MB lên rồi mới bị từ chối. */
export const MAX_FASTA_BYTES = 2 * 1024 * 1024;

/** Người nộp biết ngày lấy mẫu tới mức nào. */
export type Precision = "day" | "month" | "year";

export interface CollectionDate {
  /** Dạng gửi cho API: "2024-01-15", "2024-01" hoặc "2024". */
  value: string;
  /** Ngày đầu và ngày cuối mà giá trị đó có thể chỉ (YYYY-MM-DD). */
  first: string;
  last: string;
}

const SHAPES: Record<Precision, RegExp> = {
  day: /^(\d{4})-(\d{2})-(\d{2})$/,
  month: /^(\d{4})-(\d{2})$/,
  year: /^(\d{4})$/,
};

const pad = (value: number) => String(value).padStart(2, "0");

/** Đọc ô ngày của form; `null` nếu chưa nhập hoặc nhập không ra một ngày có thật. */
export function readCollectionDate(precision: Precision, typed: string): CollectionDate | null {
  const match = SHAPES[precision].exec(typed.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  if (month !== null && (month < 1 || month > 12)) return null;
  // Ngày 0 của tháng kế tiếp là ngày cuối của tháng này.
  const daysInMonth = month === null ? 31 : new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day !== null && (day < 1 || day > daysInMonth)) return null;

  const value = match[0];
  if (month === null) return { value, first: `${match[1]}-01-01`, last: `${match[1]}-12-31` };
  if (day === null) return { value, first: `${value}-01`, last: `${value}-${pad(daysInMonth)}` };
  return { value, first: value, last: value };
}

/**
 * Ngày lấy mẫu như server lưu ("2024-01-15", "2024-01-XX", "2024-XX-XX") thành thứ ô ngày của form giữ, ở đúng mức
 * người nộp đã khai; `null` nếu không có ngày hoặc ngày ở dạng form không giữ được.
 */
export function typedDate(stored: string | null): { precision: Precision; text: string } | null {
  const match = /^(\d{4})-(\d{2}|XX)-(\d{2}|XX)$/.exec(stored ?? "");
  if (!match) return null;
  const [, year, month, day] = match;
  if (month === "XX") return day === "XX" ? { precision: "year", text: year } : null;
  if (day === "XX") return { precision: "month", text: `${year}-${month}` };
  return { precision: "day", text: `${year}-${month}-${day}` };
}

/**
 * Các tỉnh, thành đã tồn tại vào một lúc nào đó trong khoảng ngày lấy mẫu, xếp theo tên. Mẫu chỉ biết năm 2025 có
 * thể được lấy trước hoặc sau ngày sáp nhập (1/7/2025), nên khi đó cả hai bộ cùng có mặt.
 */
export function provincesOn(units: readonly AdminUnit[], date: CollectionDate): AdminUnit[] {
  return units
    .filter(
      (unit) =>
        unit.level === "province" &&
        (unit.validFrom === null || unit.validFrom <= date.last) &&
        (unit.validTo === null || unit.validTo >= date.first),
    )
    .sort((a, b) => a.nameVi.localeCompare(b.nameVi, "vi"));
}

const KNOWN_PROBLEMS = new Set<string>([
  "NOT_FASTA",
  "MULTIPLE_SEQUENCES",
  "EMPTY_SEQUENCE",
  "INVALID_CHARACTERS",
  "SEQUENCE_TOO_SHORT",
  "SEQUENCE_TOO_LONG",
  "TOO_FEW_KNOWN_BASES",
  "FASTA_TOO_LARGE",
  "FILE_REQUIRED",
  "INVALID_NAME",
  "INVALID_DATE",
  "DATE_IN_FUTURE",
  "INVALID_HOST",
  "UNKNOWN_UNIT",
  "UNIT_NOT_VALID_ON_DATE",
]);

/** Lời báo cho một mã lỗi của server; mã chưa biết (server mới hơn giao diện) dùng lời chung. */
export function problemMessage(code: string | undefined): MessageKey {
  return code !== undefined && KNOWN_PROBLEMS.has(code) ? (`problem_${code}` as MessageKey) : "problem_OTHER";
}

const KNOWN_REJECTIONS = new Set<string>(["NOT_THIS_PATHOGEN", "TOO_FEW_VALID_SITES"]);

export function rejectionMessage(code: string | null): MessageKey {
  return code !== null && KNOWN_REJECTIONS.has(code) ? (`reject_${code}` as MessageKey) : "reject_OTHER";
}

/** Lời báo khi server không nhận thêm mẫu (429): chờ các mẫu đang kiểm tra xong, hoặc đã hết lượt của hôm nay. */
export function limitMessage(code: string): MessageKey {
  return code === "TOO_MANY_TODAY" ? "submitTooManyToday" : "submitTooMany";
}

const CORRECTABLE = new Set<SubmissionStage>(["accepted", "placement_failed", "placed", "in_tree"]);

/** Mẫu đã được nhận và không còn việc nào đang chạy cho nó thì người nộp sửa được tên, ngày, tỉnh và vật chủ. */
export function canCorrect(item: Pick<Submission, "status" | "stage">): boolean {
  return item.status === "accepted" && CORRECTABLE.has(item.stage);
}

const CORRECTION_REFUSALS: ReadonlyMap<string, MessageKey> = new Map([
  ["SAMPLE_BEING_CHECKED", "editBeingChecked"],
  ["SAMPLE_NOT_EDITABLE", "editNotEditable"],
  ["SUBMISSION_NOT_FOUND", "editNotFound"],
  ["FORBIDDEN", "editForbidden"],
]);

/** Lời báo khi server không nhận một lần sửa; mã chưa biết dùng lời chung. */
export function correctionMessage(code: string): MessageKey {
  return CORRECTION_REFUSALS.get(code) ?? "editFailed";
}

/** Một mẫu có chuỗi giống hệt chuỗi vừa nộp, ở mức người nộp được phép biết. */
export interface IdenticalSample {
  displayName: string;
  source: "genbank" | "submission";
  mine: boolean;
  /** Chỉ với mẫu của chính người nộp. */
  internalId: string | null;
  /** Chỉ với bản ghi GenBank. */
  accession: string | null;
}

export interface IdenticalSamples {
  /** Vài mẫu đầu, của chính mình trước. */
  matches: IdenticalSample[];
  /** Tổng số mẫu giống hệt. */
  total: number;
}

const orNull = (value: unknown) => value === null || typeof value === "string";

function isIdenticalSample(value: unknown): value is IdenticalSample {
  if (typeof value !== "object" || value === null) return false;
  const match = value as Record<string, unknown>;
  return (
    typeof match.displayName === "string" &&
    (match.source === "genbank" || match.source === "submission") &&
    typeof match.mine === "boolean" &&
    orNull(match.internalId) &&
    orNull(match.accession)
  );
}

/** Các mẫu giống hệt mà lời hỏi lại 409 `IDENTICAL_SEQUENCE` nêu; `null` với lỗi khác hoặc câu trả lời không đọc được. */
export function identicalSamples(error: ApiError): IdenticalSamples | null {
  const { matches, matchCount } = error.extra;
  if (error.code !== "IDENTICAL_SEQUENCE" || !Array.isArray(matches)) return null;
  const readable = matches.filter(isIdenticalSample);
  const total = typeof matchCount === "number" && Number.isInteger(matchCount) ? matchCount : 0;
  return { matches: readable, total: Math.max(total, readable.length) };
}

/** Mẫu giống hệt là của ai, nói theo cách một phòng xét nghiệm hiểu. */
export function identicalSampleNote(match: IdenticalSample): { key: MessageKey; values: Record<string, string> } {
  if (match.mine) return { key: "identicalMine", values: { id: match.internalId ?? "" } };
  if (match.source === "genbank") return { key: "identicalGenbank", values: { accession: match.accession ?? "" } };
  return { key: "identicalOther", values: {} };
}
