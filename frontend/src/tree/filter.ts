import type { Column } from "./columns";
import type { Tree } from "./parse";

/** Mã dùng trong bộ lọc cho "không có giá trị". */
export const MISSING = -1;

export interface Filters {
  /** Khoảng ngày (năm thập phân), tính cả hai đầu; `null` là không giới hạn. */
  dateMin: number | null;
  dateMax: number | null;
  /** Với mỗi cột: các mã được giữ lại. Cột không có ở đây, hoặc có danh sách rỗng, là không lọc. */
  values: Record<string, number[]>;
}

export const NO_FILTERS: Filters = { dateMin: null, dateMax: null, values: {} };

export function hasFilters(filters: Filters): boolean {
  return (
    filters.dateMin !== null ||
    filters.dateMax !== null ||
    Object.values(filters.values).some((codes) => codes.length > 0)
  );
}

/** Mặt nạ theo tip: 1 là tip qua mọi bộ lọc. Một vòng lặp trên mảng số, không tạo object nào cho từng tip. */
export function tipMask(tree: Tree, columns: ReadonlyMap<string, Column>, filters: Filters): Uint8Array {
  const { tipCount, tipNode, numDate } = tree;
  const mask = new Uint8Array(tipCount).fill(1);

  const { dateMin, dateMax } = filters;
  if (dateMin !== null || dateMax !== null) {
    const low = dateMin ?? -Infinity;
    const high = dateMax ?? Infinity;
    for (let k = 0; k < tipCount; k++) {
      const date = numDate[tipNode[k]];
      // Tip không có ngày không thuộc khoảng ngày nào.
      if (!(date >= low && date <= high)) mask[k] = 0;
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
