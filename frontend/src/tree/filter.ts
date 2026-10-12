import type { MapLevel } from "../map/types";
import type { Column } from "./columns";
import { dayRange } from "./dates";
import type { Tree } from "./parse";

/** Mã dùng trong bộ lọc cho "không có giá trị". */
export const MISSING = -1;

/** Các địa bàn được chọn trên bản đồ, cùng một cấp; mã là mã của bảng `admin_unit`. */
export interface AreaFilter {
  level: MapLevel;
  codes: string[];
}

export interface Filters {
  /** Khoảng ngày (YYYY-MM-DD) của tip trên cây, tính cả hai ngày; `null` là không giới hạn. */
  dateFrom: string | null;
  dateTo: string | null;
  /** Với mỗi cột: các mã được giữ lại. Cột không có ở đây, hoặc có danh sách rỗng, là không lọc. */
  values: Record<string, number[]>;
  /**
   * Giữ các tip được xếp vào một trong những địa bàn này. `tipMask` không xử lý phần này: việc xếp tip vào địa bàn
   * cần hình học của bản đồ, nên mặt nạ của nó được tính ở `map/placement` rồi giao với mặt nạ của `tipMask`.
   */
  area: AreaFilter | null;
}

export const NO_FILTERS: Filters = { dateFrom: null, dateTo: null, values: {}, area: null };

export function hasFilters(filters: Filters): boolean {
  return (
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.area !== null ||
    Object.values(filters.values).some((codes) => codes.length > 0)
  );
}

/**
 * Bật hoặc tắt một địa bàn trong bộ lọc của bản đồ. Địa bàn cùng cấp thì thêm vào hoặc bỏ ra; địa bàn ở cấp khác
 * thì thay cả bộ lọc, vì hai cấp chồng lên nhau (chọn một miền rồi một tỉnh là muốn xem tỉnh đó).
 */
export function toggleArea(current: AreaFilter | null, level: MapLevel, code: string): AreaFilter | null {
  if (current === null || current.level !== level) return { level, codes: [code] };
  const codes = current.codes.includes(code)
    ? current.codes.filter((other) => other !== code)
    : [...current.codes, code];
  return codes.length > 0 ? { level, codes } : null;
}

/** Giao của hai mặt nạ: 1 ở tip mà cả hai cùng giữ. */
export function intersect(a: Uint8Array, b: Uint8Array): Uint8Array {
  return Uint8Array.from(a, (kept, index) => kept & b[index]);
}

/** Mặt nạ theo tip: 1 là tip qua mọi bộ lọc. Một vòng lặp trên mảng số, không tạo object nào cho từng tip. */
export function tipMask(tree: Tree, columns: ReadonlyMap<string, Column>, filters: Filters): Uint8Array {
  const { tipCount, tipNode, numDate } = tree;
  const mask = new Uint8Array(tipCount).fill(1);

  if (filters.dateFrom !== null || filters.dateTo !== null) {
    const [from, before] = dayRange(filters.dateFrom, filters.dateTo);
    for (let k = 0; k < tipCount; k++) {
      const date = numDate[tipNode[k]];
      // Tip không có ngày không thuộc khoảng ngày nào.
      if (!(date >= from && date < before)) mask[k] = 0;
    }
  }

  for (const [key, codes] of Object.entries(filters.values)) {
    const column = columns.get(key);
    if (!column || codes.length === 0) continue;
    // Bảng tra theo mã, lệch một ô để mã -1 (thiếu) có chỗ.
    const allowed = new Uint8Array(column.values.length + 1);
    for (const code of codes) {
      if (code >= MISSING && code < column.values.length) allowed[code + 1] = 1;
    }
    const tipCodes = column.tipCodes;
    for (let k = 0; k < tipCount; k++) {
      if (!allowed[tipCodes[k] + 1]) mask[k] = 0;
    }
  }
  return mask;
}

/** Mặt nạ theo node: 1 là node có ít nhất một tip con cháu qua bộ lọc (nhánh dẫn tới nó được vẽ đậm). */
export function nodeMask(tree: Tree, tips: Uint8Array): Uint8Array {
  const { nodeCount, parent, tipOfNode } = tree;
  const mask = new Uint8Array(nodeCount);
  // Cha đứng trước con: duyệt ngược thì mỗi node đã biết hết con của nó trước khi báo lên cha.
  for (let i = nodeCount - 1; i >= 0; i--) {
    const tip = tipOfNode[i];
    if (tip >= 0) mask[i] = tips[tip];
    if (mask[i] && parent[i] >= 0) mask[parent[i]] = 1;
  }
  return mask;
}

export function countSet(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i];
  return count;
}

/** Số tip qua bộ lọc theo từng giá trị của một cột (để chú giải hiện số lượng đang thấy). */
export function visibleCounts(column: Column, tips: Uint8Array): { counts: Int32Array; missing: number } {
  const counts = new Int32Array(column.values.length);
  let missing = 0;
  const codes = column.tipCodes;
  for (let k = 0; k < codes.length; k++) {
    if (!tips[k]) continue;
    if (codes[k] < 0) missing++;
    else counts[codes[k]]++;
  }
  return { counts, missing };
}
