import { dayRange, decimalYear } from "./dates";
import { hasFilters, type Filters } from "./filter";
import type { Axis, Layout, Positions } from "./layout";
import type { Tree } from "./parse";
import type { View } from "./view";

/**
 * Tip tạm: mẫu vừa nộp, được Nextclade gắn vào cây của build hiện hành trong lúc chờ lần build có nó.
 *
 * Tip tạm không nằm trong các mảng của cây. Mỗi tip chỉ biết nó tách ra từ cành nào và ở đoạn nào của cành đó;
 * vị trí để vẽ được tính từ vị trí của các node có sẵn, nên thêm hay bớt tip tạm không tính lại bố cục của cây.
 */

/** Một tip tạm như `GET /api/datasets/<slug>/placements` trả về. */
export interface ProvisionalTip {
  internalId: string;
  displayName: string;
  collectionDate: string | null;
  dateMin: string | null;
  dateMax: string | null;
  unitCode: string | null;
  host: string | null;
  /** Node gần nhất phía trên mẫu mà cây có (chỉ số trong các mảng của cây). */
  parentIndex: number;
  /** Node mà cành dẫn tới nó bị chẻ ra để gắn mẫu; `null` khi mẫu treo thẳng vào `parentIndex`. */
  branchIndex: number | null;
  attachDiv: number;
  div: number;
  privateMutations: number;
  clade: string | null;
}

export interface Provisional {
  tips: ProvisionalTip[];
  /** Node mà tip được vẽ cạnh: node bị chẻ cành nếu có, không thì node phía trên. */
  anchor: Int32Array;
  /** Điểm tip tách khỏi cành dẫn tới `anchor`: 0 ở node cha của `anchor`, 1 ở chính `anchor`. */
  fraction: Float32Array;
  div: Float32Array;
  /** Ngày lấy mẫu do người nộp khai, dạng năm thập phân (giữa khoảng ngày); NaN khi không có. */
  date: Float64Array;
}

function midDate(tip: ProvisionalTip): number {
  const first = tip.dateMin === null ? null : decimalYear(tip.dateMin);
  const last = tip.dateMax === null ? null : decimalYear(tip.dateMax);
  if (first === null || last === null) return NaN;
  return (first + last) / 2;
}

function isNode(tree: Tree, index: number | null): index is number {
  return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < tree.nodeCount;
}

/** Gắn các tip tạm vào cây. Tip trỏ tới node mà cây không có (API và cây lệch bản) bị bỏ, không vẽ sai chỗ. */
export function attachProvisional(tree: Tree, tips: readonly ProvisionalTip[]): Provisional {
  const kept = tips.filter(
    (tip) =>
      isNode(tree, tip.parentIndex) &&
      // Node bị chẻ cành phải là con trực tiếp của node phía trên; không phải thì hai chỉ số không cùng một cây.
      (tip.branchIndex === null || (isNode(tree, tip.branchIndex) && tree.parent[tip.branchIndex] === tip.parentIndex)),
  );
  const anchor = new Int32Array(kept.length);
  const fraction = new Float32Array(kept.length);
  const div = new Float32Array(kept.length);
  const date = new Float64Array(kept.length);
  kept.forEach((tip, i) => {
    anchor[i] = tip.branchIndex ?? tip.parentIndex;
    div[i] = tip.div;
    date[i] = midDate(tip);
    if (tip.branchIndex === null) {
      fraction[i] = 1;
      return;
    }
    const from = tree.div[tip.parentIndex];
    const length = tree.div[tip.branchIndex] - from;
    const along = length > 0 ? (tip.attachDiv - from) / length : 1;
    fraction[i] = Number.isFinite(along) ? Math.min(1, Math.max(0, along)) : 1;
  });
  return { tips: kept, anchor, fraction, div, date };
}

/** Khoảng giá trị của các tip tạm trên một trục, để trục của cây chừa chỗ cho chúng; `null` khi không có giá trị nào. */
export function provisionalExtent(provisional: Provisional | null, axis: Axis): [number, number] | null {
  if (provisional === null) return null;
  const values = axis === "time" ? provisional.date : provisional.div;
  let min = Infinity;
  let max = -Infinity;
  // Tip không có giá trị trên trục (NaN) không qua được phép so sánh nào, nên tự bị bỏ qua.
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? [min, max] : null;
}

/**
 * Tip tạm nào qua bộ lọc. Bộ lọc theo ngày xét ngày lấy mẫu của chính tip. Các bộ lọc khác (thuộc tính, địa bàn)
 * đọc các cột của build, mà tip tạm không có mặt trong đó: khi một bộ lọc như vậy đang bật thì tip tạm không
 * được hiện, thay vì hiện một mẫu mà ta không biết có khớp bộ lọc hay không.
 */
export function provisionalMask(provisional: Provisional, filters: Filters): Uint8Array {
  const mask = new Uint8Array(provisional.tips.length);
  if (hasFilters({ ...filters, dateFrom: null, dateTo: null })) return mask;
  const [from, before] = dayRange(filters.dateFrom, filters.dateTo);
  const dated = filters.dateFrom !== null || filters.dateTo !== null;
  for (let i = 0; i < mask.length; i++) {
    const date = provisional.date[i];
    mask[i] = dated ? (date >= from && date < before ? 1 : 0) : 1;
  }
  return mask;
}

/** Vị trí của từng tip tạm trong hệ toạ độ cây, và điểm nó tách khỏi cành. */
export interface ProvisionalPositions {
  layout: Layout;
  x: Float32Array;
  y: Float32Array;
  fromX: Float32Array;
  fromY: Float32Array;
}

const FULL_TURN = 2 * Math.PI;

export function placeProvisional(tree: Tree, positions: Positions, provisional: Provisional): ProvisionalPositions {
  const count = provisional.tips.length;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const fromX = new Float32Array(count);
  const fromY = new Float32Array(count);
  const span = positions.max - positions.min || 1;
  const values = positions.axis === "time" ? provisional.date : provisional.div;

  // Các tip cùng treo cạnh một node chia nhau khoảng trống giữa hàng của node đó và hàng kế tiếp.
  const sharing = new Map<number, number>();
  for (const node of provisional.anchor) sharing.set(node, (sharing.get(node) ?? 0) + 1);
  const taken = new Map<number, number>();

  for (let i = 0; i < count; i++) {
    const node = provisional.anchor[i];
    const up = tree.parent[node] >= 0 ? tree.parent[node] : node;
    const fraction = provisional.fraction[i];
    const fromAlong = positions.along[up] + (positions.along[node] - positions.along[up]) * fraction;
    const value = values[i];
    // Không có giá trị trên trục này (mẫu không khai ngày): đứng ngay tại điểm tách.
    const along = Number.isNaN(value) ? fromAlong : (value - positions.min) / span;
    const turn = (taken.get(node) ?? 0) + 1;
    taken.set(node, turn);
    const shift = turn / (sharing.get(node)! + 1);

    if (positions.angle === null) {
      const row = 1 / Math.max(1, tree.tipCount - 1);
      fromX[i] = fromAlong;
      fromY[i] = positions.y[node];
      x[i] = along;
      y[i] = positions.y[node] + shift * row;
    } else {
      const fromAngle = positions.angle[node];
      const angle = fromAngle + (shift * FULL_TURN) / Math.max(1, tree.tipCount);
      fromX[i] = 0.5 + 0.5 * fromAlong * Math.cos(fromAngle);
      fromY[i] = 0.5 + 0.5 * fromAlong * Math.sin(fromAngle);
      x[i] = 0.5 + 0.5 * along * Math.cos(angle);
      y[i] = 0.5 + 0.5 * along * Math.sin(angle);
    }
  }
  return { layout: positions.layout, x, y, fromX, fromY };
}

/** Nửa đường chéo (pixel) của hình thoi đánh dấu một tip tạm. Cố định, để tip tạm vẫn thấy được khi cây thu nhỏ. */
export const MARKER = 5;

export interface ProvisionalLayer {
  positions: ProvisionalPositions;
  visible: Uint8Array;
  hover: number;
  selected: number;
}

/** Phần của Canvas 2D mà việc vẽ tip tạm dùng tới. */
export type MarkerSurface = Pick<
  CanvasRenderingContext2D,
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "stroke"
  | "fill"
  | "setLineDash"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
>;

function diamond(ctx: MarkerSurface, px: number, py: number, half: number): void {
  ctx.beginPath();
  ctx.moveTo(px, py - half);
  ctx.lineTo(px + half, py);
  ctx.lineTo(px, py + half);
  ctx.lineTo(px - half, py);
  ctx.closePath();
}

/**
 * Vẽ các tip tạm đè lên cây đã vẽ: một nét đứt từ điểm tách tới tip, và một hình thoi rỗng. Hình dạng (không phải
 * màu) phân biệt tip tạm với tip của build, nên việc tô màu theo thuộc tính không ảnh hưởng tới nó.
 * Tip có tâm nằm dưới `bottom` (dải nhãn trục) không được vẽ. Trả về số tip đã vẽ.
 */
export function drawProvisional(
  ctx: MarkerSurface,
  view: View,
  layer: ProvisionalLayer,
  colors: { ink: string; background: string },
  bottom: number,
): number {
  const { positions, visible } = layer;
  const px = (i: number) => view.offsetX + positions.x[i] * view.scaleX;
  const py = (i: number) => view.offsetY + positions.y[i] * view.scaleY;
  const shown: number[] = [];
  for (let i = 0; i < visible.length; i++) if (visible[i] === 1 && py(i) <= bottom) shown.push(i);
  if (shown.length === 0) return 0;

  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  for (const i of shown) {
    const fx = view.offsetX + positions.fromX[i] * view.scaleX;
    const fy = view.offsetY + positions.fromY[i] * view.scaleY;
    ctx.moveTo(fx, fy);
    // Bố cục chữ nhật: đi dọc xuống hàng của tip rồi đi ngang, như một cành của cây. Toả tròn: một đoạn thẳng.
    if (positions.layout === "rect") ctx.lineTo(fx, py(i));
    ctx.lineTo(px(i), py(i));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = colors.background;
  ctx.lineWidth = 1.75;
  for (const i of shown) {
    diamond(ctx, px(i), py(i), MARKER);
    ctx.fill();
    ctx.stroke();
  }
  for (const [index, half, width] of [
    [layer.selected, MARKER + 5, 2.5],
    [layer.hover === layer.selected ? -1 : layer.hover, MARKER + 4, 1.5],
  ]) {
    if (!shown.includes(index)) continue;
    diamond(ctx, px(index), py(index), half);
    ctx.lineWidth = width;
    ctx.stroke();
  }
  return shown.length;
}

/** Tip tạm đang hiện gần điểm (x, y) của canvas nhất, trong vòng `radius` pixel tính từ mép hình thoi; -1 nếu không có. */
export function provisionalAt(layer: ProvisionalLayer, view: View, x: number, y: number, radius: number): number {
  const { positions, visible } = layer;
  let best = -1;
  let bestDistance = radius + MARKER;
  for (let i = 0; i < visible.length; i++) {
    if (visible[i] !== 1) continue;
    const distance = Math.hypot(
      view.offsetX + positions.x[i] * view.scaleX - x,
      view.offsetY + positions.y[i] * view.scaleY - y,
    );
    if (distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}
