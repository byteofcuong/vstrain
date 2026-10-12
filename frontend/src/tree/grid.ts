import type { Positions } from "./layout";
import type { Tree } from "./parse";

/**
 * Lưới đều trên hệ toạ độ cây, mỗi ô giữ danh sách tip nằm trong nó.
 *
 * Tìm tip dưới con trỏ chỉ xem vài ô quanh con trỏ thay vì duyệt cả cây. Lưới nằm trong hệ toạ độ cây nên
 * không phải dựng lại khi phóng to hay kéo; chỉ dựng lại khi đổi bố cục hoặc đổi trục.
 */
export interface TipGrid {
  size: number;
  /** Tip của ô c là `items[start[c] .. start[c + 1])`. */
  start: Int32Array;
  items: Int32Array;
}

function cell(value: number, size: number): number {
  const index = Math.floor(value * size);
  return index < 0 ? 0 : index >= size ? size - 1 : index;
}

export function gridSize(tipCount: number): number {
  // Khoảng một tip mỗi ô nếu tip rải đều; trên thực tế tip dồn về phía ngày gần đây nên ô đông hơn thế.
  return Math.min(512, Math.max(8, Math.ceil(Math.sqrt(tipCount))));
}

export function buildTipGrid(tree: Tree, positions: Positions, size = gridSize(tree.tipCount)): TipGrid {
  const { tipCount, tipNode } = tree;
  const { x, y } = positions;
  const cellOfTip = new Int32Array(tipCount);
  const start = new Int32Array(size * size + 1);
  for (let k = 0; k < tipCount; k++) {
    const node = tipNode[k];
    const index = cell(y[node], size) * size + cell(x[node], size);
    cellOfTip[k] = index;
    start[index + 1]++;
  }
  for (let c = 0; c < size * size; c++) start[c + 1] += start[c];
  const next = start.slice(0, size * size);
  const items = new Int32Array(tipCount);
  for (let k = 0; k < tipCount; k++) items[next[cellOfTip[k]]++] = k;
  return { size, start, items };
}

/**
 * Tip gần điểm (x, y) nhất trong bán kính cho trước, hoặc -1. Bán kính cho riêng từng chiều (đơn vị của hệ
 * toạ độ cây) vì một pixel ứng với hai khoảng khác nhau theo chiều ngang và chiều dọc.
 * `visible` (theo tip) giới hạn việc tìm ở những tip đang hiện.
 */
export function nearestTip(
  grid: TipGrid,
  tree: Tree,
  positions: Positions,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  visible?: Uint8Array,
): number {
  const { size, start, items } = grid;
  const { tipNode } = tree;
  const column0 = cell(x - radiusX, size);
  const column1 = cell(x + radiusX, size);
  const row0 = cell(y - radiusY, size);
  const row1 = cell(y + radiusY, size);
  let best = -1;
  let bestDistance = 1; // khoảng cách đã chia cho bán kính; 1 là mép của vùng tìm
  for (let row = row0; row <= row1; row++) {
    for (let column = column0; column <= column1; column++) {
      const index = row * size + column;
      for (let at = start[index]; at < start[index + 1]; at++) {
        const tip = items[at];
        if (visible && !visible[tip]) continue;
        const node = tipNode[tip];
        const dx = (positions.x[node] - x) / radiusX;
        const dy = (positions.y[node] - y) / radiusY;
        const distance = dx * dx + dy * dy;
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = tip;
        }
      }
    }
  }
  return best;
}
