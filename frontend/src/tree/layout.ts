import type { Tree } from "./parse";

export type Layout = "rect" | "radial";
export type Axis = "time" | "div";

/**
 * Vị trí của mọi node trong "hệ toạ độ cây": hình vuông [0, 1] × [0, 1], không phụ thuộc kích thước màn hình.
 * Phóng to, thu nhỏ và kéo chỉ đổi phép biến đổi sang pixel (`View`), không tính lại mảng này.
 */
export interface Positions {
  layout: Layout;
  axis: Axis;
  x: Float32Array;
  y: Float32Array;
  /** Vị trí của node dọc theo trục (0 ở giá trị nhỏ nhất, 1 ở giá trị lớn nhất). */
  along: Float32Array;
  /** Góc của node (radian) trong bố cục toả tròn; `null` với bố cục chữ nhật. */
  angle: Float32Array | null;
  /** Khoảng giá trị của trục: năm thập phân với trục thời gian, số thay thế mỗi vị trí với trục phân kỳ. */
  min: number;
  max: number;
}

const FULL_TURN = 2 * Math.PI;

export function axisValues(tree: Tree, axis: Axis): Float64Array | Float32Array {
  return axis === "time" ? tree.numDate : tree.div;
}

/**
 * `extent` nới khoảng giá trị của trục để chứa cả những điểm nằm ngoài cây (tip tạm): một mẫu vừa nộp thường mới
 * hơn mọi tip của build, và phải có chỗ trên trục thay vì rơi ra ngoài mép.
 */
export function computePositions(
  tree: Tree,
  layout: Layout,
  axis: Axis,
  extent: readonly [number, number] | null = null,
): Positions {
  const { nodeCount, tipCount, parent, order } = tree;
  const values = axisValues(tree, axis);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < nodeCount; i++) {
    const value = values[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (extent !== null) {
    min = Math.min(min, extent[0]);
    max = Math.max(max, extent[1]);
  }
  if (!(min <= max)) {
    min = 0;
    max = 1;
  }
  const span = max - min || 1;

  const along = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const value = values[i];
    // Node không có giá trị đứng cùng chỗ với cha của nó (cha luôn được tính trước).
    along[i] = Number.isNaN(value) ? (parent[i] >= 0 ? along[parent[i]] : 0) : (value - min) / span;
  }

  const x = new Float32Array(nodeCount);
  const y = new Float32Array(nodeCount);
  if (layout === "rect") {
    const rows = Math.max(1, tipCount - 1);
    for (let i = 0; i < nodeCount; i++) {
      x[i] = along[i];
      y[i] = tipCount > 1 ? order[i] / rows : 0.5;
    }
    return { layout, axis, x, y, along, angle: null, min, max };
  }

  const angle = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const theta = (order[i] / Math.max(1, tipCount)) * FULL_TURN;
    angle[i] = theta;
    x[i] = 0.5 + 0.5 * along[i] * Math.cos(theta);
    y[i] = 0.5 + 0.5 * along[i] * Math.sin(theta);
  }
  return { layout, axis, x, y, along, angle, min, max };
}
