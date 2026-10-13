import type { AdminUnit } from "../api";
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
