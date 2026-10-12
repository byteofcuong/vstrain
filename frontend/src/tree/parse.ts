/**
 * Cây của một build, dưới dạng typed array.
 *
 * Auspice giữ cây là một đồ thị object trong Redux; mỗi thao tác (lọc, đổi màu) duyệt qua hàng chục nghìn
 * object và tạo object mới. Ở đây cây là vài mảng số song song theo thứ tự duyệt trước (cha luôn đứng trước
 * con), nằm ngoài React: một vòng lặp trên mảng là đủ cho mọi phép tính, và mảng chuyển được giữa Web Worker
 * và main thread mà không sao chép.
 */

/** `tree.json` như backend publish (định dạng 1). */
export interface TreeFile {
  nodeCount: number;
  tipCount: number;
  name: string[];
  parent: number[];
  div: (number | null)[];
  numDate: (number | null)[];
  numDateLower: (number | null)[];
  numDateUpper: (number | null)[];
  tipNode: number[];
}

export interface Tree {
  nodeCount: number;
  tipCount: number;
  /** Mã nội bộ của mẫu ở từng tip (ví dụ "S0000123"). Tên của node trong không được giữ: giao diện không dùng. */
  tipNames: string[];
  /** Chỉ số node cha; gốc là -1. */
  parent: Int32Array;
  /** Độ phân kỳ so với gốc; NaN khi không có. */
  div: Float32Array;
  /** Ngày dạng số thập phân (2019.5); NaN khi không có. */
  numDate: Float64Array;
  numDateLower: Float64Array;
  numDateUpper: Float64Array;
  /** Tip thứ k là node `tipNode[k]`. */
  tipNode: Int32Array;
  /** Node i là tip thứ `tipOfNode[i]`, hoặc -1 nếu là node trong. */
  tipOfNode: Int32Array;
  /** Vị trí dọc của node: tip thứ k ở k; node trong ở giữa con đầu và con cuối. */
  order: Float32Array;
}

export class TreeFormatError extends Error {}

function fail(message: string): never {
  throw new TreeFormatError(`Invalid tree file: ${message}`);
}

function numbers(values: (number | null)[]): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    out[i] = typeof value === "number" ? value : NaN;
  }
  return out;
}

/** Vị trí dọc: mỗi tip một hàng theo thứ tự trong cây, node trong nằm giữa các con của nó. */
export function verticalOrder(parent: Int32Array, tipOfNode: Int32Array): Float32Array {
  const count = parent.length;
  const order = new Float32Array(count);
  const low = new Float32Array(count).fill(Infinity);
  const high = new Float32Array(count).fill(-Infinity);
  // Cha đứng trước con, nên duyệt ngược là gặp mọi con trước khi gặp cha.
  for (let i = count - 1; i >= 0; i--) {
    order[i] = tipOfNode[i] >= 0 ? tipOfNode[i] : (low[i] + high[i]) / 2;
    const up = parent[i];
    if (up >= 0) {
      if (order[i] < low[up]) low[up] = order[i];
      if (order[i] > high[up]) high[up] = order[i];
    }
  }
  return order;
}

/** Kiểm tra và chuyển `tree.json` thành typed array. Ném `TreeFormatError` khi file không đúng dạng. */
export function parseTree(file: TreeFile): Tree {
  const { nodeCount, tipCount } = file;
  if (!Number.isInteger(nodeCount) || nodeCount < 1) fail("nodeCount must be a positive integer");
  for (const key of ["name", "parent", "div", "numDate", "numDateLower", "numDateUpper"] as const) {
    if (!Array.isArray(file[key]) || file[key].length !== nodeCount) fail(`${key} must have ${nodeCount} entries`);
  }
  if (!Array.isArray(file.tipNode) || file.tipNode.length !== tipCount) fail(`tipNode must have ${tipCount} entries`);

  const parent = Int32Array.from(file.parent);
  if (parent[0] !== -1) fail("the first node must be the root");
  const childCount = new Int32Array(nodeCount);
  for (let i = 1; i < nodeCount; i++) {
    const up = parent[i];
    if (!(up >= 0 && up < i)) fail(`node ${i} must come after its parent`);
    childCount[up]++;
  }

  const tipNode = Int32Array.from(file.tipNode);
  const tipOfNode = new Int32Array(nodeCount).fill(-1);
  for (let k = 0; k < tipCount; k++) {
    const node = tipNode[k];
    if (!(node >= 0 && node < nodeCount) || childCount[node] !== 0) fail(`tip ${k} does not point to a leaf`);
    if (tipOfNode[node] !== -1) fail(`node ${node} is listed as a tip twice`);
    if (k > 0 && node <= tipNode[k - 1]) fail("tips must be listed in tree order");
    tipOfNode[node] = k;
  }
  for (let i = 0; i < nodeCount; i++) {
    if (childCount[i] === 0 && tipOfNode[i] === -1) fail(`leaf ${i} is missing from tipNode`);
  }

  return {
    nodeCount,
    tipCount,
    tipNames: Array.from(tipNode, (node) => file.name[node]),
    parent,
    div: Float32Array.from(numbers(file.div)),
    numDate: numbers(file.numDate),
    numDateLower: numbers(file.numDateLower),
    numDateUpper: numbers(file.numDateUpper),
    tipNode,
    tipOfNode,
    order: verticalOrder(parent, tipOfNode),
  };
}
