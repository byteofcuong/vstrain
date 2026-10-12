import type { Tree } from "./parse";

/** `col.<key>.json` như backend publish: cột mã hoá từ điển. */
export interface ColumnFile {
  key: string;
  scope: "tip" | "node";
  values: string[];
  labels?: string[];
  codes: number[];
}

/** Một thuộc tính của tip: mỗi tip một mã, mã là chỉ số trong `values`, -1 là không có giá trị. */
export interface Column {
  key: string;
  values: string[];
  /** Tên để hiển thị của từng giá trị (ví dụ tên tỉnh cho mã đơn vị). */
  labels: string[];
  /** Mã của từng tip, theo thứ tự tip. */
  tipCodes: Int32Array;
  /** Mã của từng node, chỉ có ở cột được suy diễn cho cả node trong (genotype). */
  nodeCodes: Int32Array | null;
  /** Số tip mang từng giá trị. */
  counts: Int32Array;
  missing: number;
}

export class ColumnFormatError extends Error {}

/** Phần của cây mà việc đọc một cột cần tới. */
export type TreeShape = Pick<Tree, "nodeCount" | "tipCount" | "tipNode">;

export function parseColumn(file: ColumnFile, tree: TreeShape): Column {
  const expected = file.scope === "node" ? tree.nodeCount : tree.tipCount;
  if (!Array.isArray(file.codes) || file.codes.length !== expected) {
    throw new ColumnFormatError(`Column ${file.key} must have ${expected} codes`);
  }
  const valueCount = file.values.length;
  const codes = Int32Array.from(file.codes);
  for (let i = 0; i < codes.length; i++) {
    if (!(codes[i] >= -1 && codes[i] < valueCount)) {
      throw new ColumnFormatError(`Column ${file.key} has a code outside its ${valueCount} values`);
    }
  }

  let tipCodes = codes;
  let nodeCodes: Int32Array | null = null;
  if (file.scope === "node") {
    nodeCodes = codes;
    tipCodes = new Int32Array(tree.tipCount);
    for (let k = 0; k < tree.tipCount; k++) tipCodes[k] = codes[tree.tipNode[k]];
  }

  const counts = new Int32Array(valueCount);
  let missing = 0;
  for (let k = 0; k < tipCodes.length; k++) {
    if (tipCodes[k] < 0) missing++;
    else counts[tipCodes[k]]++;
  }
  return {
    key: file.key,
    values: file.values,
    labels: file.labels ?? file.values,
    tipCodes,
    nodeCodes,
    counts,
    missing,
  };
}
