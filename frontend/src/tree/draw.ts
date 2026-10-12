import type { Guides } from "./axis";
import type { Positions } from "./layout";
import type { Tree } from "./parse";
import type { View } from "./view";

/**
 * Vẽ cây lên Canvas 2D.
 *
 * Auspice tạo khoảng 3,5 phần tử SVG cho mỗi tip và đổi thuộc tính từng phần tử khi lọc hay đổi màu. Ở đây
 * mỗi khung hình là vài path: nhánh được gom theo màu, tip được gom theo màu, và khi nhiều tip rơi vào cùng
 * một pixel thì chỉ vẽ một. Chi phí của một khung hình vì thế bị chặn bởi số pixel chứ không chỉ bởi số tip.
 */

export interface Theme {
  branch: string;
  /** Nhánh không dẫn tới tip nào qua bộ lọc. */
  branchMuted: string;
  /** Tip không có giá trị ở cột đang tô màu. */
  missing: string;
  /** Viền của tip đang được rê chuột hoặc được chọn. */
  highlight: string;
  background: string;
  /** Đường dóng của trục và chữ ghi mốc. */
  guide: string;
  guideText: string;
  font: string;
}

export interface Scene {
  tree: Tree;
  positions: Positions;
  view: View;
  /** Kích thước canvas theo pixel CSS. */
  width: number;
  height: number;
  tipVisible: Uint8Array;
  nodeVisible: Uint8Array;
  /** Mã màu của từng tip (chỉ số trong `colors`, -1 là thiếu); `null` khi không tô màu. */
  tipCodes: Int32Array | null;
  /** Mã màu của từng node, để tô cả nhánh; `null` thì nhánh có một màu. */
  nodeCodes: Int32Array | null;
  colors: readonly string[];
  theme: Theme;
  hoverTip: number;
  selectedTip: number;
  guides: Guides | null;
}

export interface DrawStats {
  tipsVisible: number;
  tipsDrawn: number;
  branchesDrawn: number;
}

/** Bộ đệm dùng lại giữa các khung hình, để mỗi lần vẽ không cấp phát mảng mới. */
export interface Scratch {
  seen: Uint8Array;
  drawn: Int32Array;
  sorted: Int32Array;
  bucket: Int32Array;
}

export function createScratch(): Scratch {
  return { seen: new Uint8Array(0), drawn: new Int32Array(0), sorted: new Int32Array(0), bucket: new Int32Array(0) };
}

const FULL_TURN = 2 * Math.PI;
/** Nhánh ngắn hơn mức này (pixel) theo cả hai chiều thì không nhìn thấy được và được bỏ qua. */
const TINY = 0.25;
/** Tô màu nhánh theo cột chỉ khi cột có ít giá trị: mỗi màu là một lượt duyệt qua mọi node. */
export const MAX_BRANCH_COLORS = 32;

/** Bán kính của tip theo khoảng cách giữa hai tip kề nhau trên màn hình. */
export function tipRadius(scene: Pick<Scene, "tree" | "positions" | "view">): number {
  const { tree, positions, view } = scene;
  const spacing =
    positions.layout === "rect"
      ? view.scaleY / Math.max(1, tree.tipCount - 1)
      : (Math.PI * view.scaleX) / Math.max(1, tree.tipCount);
  return Math.min(4.5, Math.max(1, spacing * 0.4));
}

function traceBranches(ctx: CanvasRenderingContext2D, scene: Scene, visible: 0 | 1, code: number | null): number {
  const { tree, positions, view, width, height, nodeVisible, nodeCodes } = scene;
  const { parent, nodeCount } = tree;
  const { x, y, along, angle } = positions;
  const { scaleX, scaleY, offsetX, offsetY } = view;
  const centerX = offsetX + 0.5 * scaleX;
  const centerY = offsetY + 0.5 * scaleY;
  let count = 0;

  ctx.beginPath();
  for (let i = 1; i < nodeCount; i++) {
    if (nodeVisible[i] !== visible) continue;
    if (code !== null && nodeCodes !== null && nodeCodes[i] !== code) continue;
    const up = parent[i];
    const x0 = offsetX + x[up] * scaleX;
    const y0 = offsetY + y[up] * scaleY;
    const x1 = offsetX + x[i] * scaleX;
    const y1 = offsetY + y[i] * scaleY;
    if ((x0 < 0 && x1 < 0) || (x0 > width && x1 > width) || (y0 < 0 && y1 < 0) || (y0 > height && y1 > height)) {
      // Trong bố cục toả tròn, cung nối hai đầu có thể đi qua khung nhìn dù cả hai đầu ở ngoài; chấp nhận
      // bỏ sót trường hợp hiếm này để không phải vẽ mọi nhánh khi đã phóng to.
      continue;
    }
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx < TINY && dx > -TINY && dy < TINY && dy > -TINY) continue;

    ctx.moveTo(x0, y0);
    if (angle === null) {
      ctx.lineTo(x0, y1);
    } else if (along[up] > 0) {
      ctx.arc(centerX, centerY, along[up] * 0.5 * scaleX, angle[up], angle[i], angle[i] < angle[up]);
    }
    ctx.lineTo(x1, y1);
    count++;
  }
  return count;
}

function ensure(scratch: Scratch, pixels: number, tips: number, colors: number): void {
  if (scratch.seen.length < pixels) scratch.seen = new Uint8Array(pixels);
  else scratch.seen.fill(0, 0, pixels);
  if (scratch.drawn.length < tips) {
    scratch.drawn = new Int32Array(tips);
    scratch.sorted = new Int32Array(tips);
  }
  if (scratch.bucket.length < colors + 2) scratch.bucket = new Int32Array(colors + 2);
  else scratch.bucket.fill(0, 0, colors + 2);
}

function ring(ctx: CanvasRenderingContext2D, scene: Scene, tip: number, radius: number, lineWidth: number): void {
  if (tip < 0 || tip >= scene.tree.tipCount) return;
  const node = scene.tree.tipNode[tip];
  const px = scene.view.offsetX + scene.positions.x[node] * scene.view.scaleX;
  const py = scene.view.offsetY + scene.positions.y[node] * scene.view.scaleY;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, FULL_TURN);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = scene.theme.highlight;
  ctx.stroke();
}

/** Chiều cao dải ghi nhãn trục ở đáy canvas (bố cục chữ nhật). */
export const AXIS_BAND = 24;

function drawGuides(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { guides, theme, view, height } = scene;
  if (guides === null) return;
  ctx.strokeStyle = theme.guide;
  ctx.fillStyle = theme.guideText;
  ctx.lineWidth = 1;
  ctx.font = theme.font;
  ctx.textBaseline = "alphabetic";

  if (guides.kind === "lines") {
    ctx.textAlign = "center";
    ctx.beginPath();
    for (const position of guides.positions) {
      // Nửa pixel để đường 1 pixel không bị nhoè ra hai pixel.
      const px = Math.round(position) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height - AXIS_BAND);
    }
    ctx.stroke();
    return;
  }

  const centerX = view.offsetX + 0.5 * view.scaleX;
  const centerY = view.offsetY + 0.5 * view.scaleY;
  ctx.textAlign = "left";
  guides.radii.forEach((radius, index) => {
    if (radius <= 0) return;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, FULL_TURN);
    ctx.stroke();
    ctx.fillText(guides.labels[index], centerX + 4, centerY - radius - 3);
  });
}

/** Dải nhãn trục ở đáy, vẽ sau cùng để cây đã phóng to không đè lên chữ. */
function drawAxisBand(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { guides, theme, width, height } = scene;
  if (guides === null || guides.kind !== "lines") return;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, height - AXIS_BAND, width, AXIS_BAND);
  ctx.fillStyle = theme.guideText;
  ctx.font = theme.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  guides.labels.forEach((text, index) => {
    ctx.fillText(text, guides.positions[index], height - 8);
  });
}

/** Vẽ một khung hình. `ctx` đã được đặt tỉ lệ theo devicePixelRatio; mọi toạ độ ở đây là pixel CSS. */
export function drawTree(ctx: CanvasRenderingContext2D, scene: Scene, scratch: Scratch): DrawStats {
  const { tree, positions, view, width, height, tipVisible, tipCodes, nodeCodes, colors, theme } = scene;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  drawGuides(ctx, scene);
  ctx.lineJoin = "round";

  // Nhánh mờ trước, nhánh đang hiện đè lên trên.
  let branchesDrawn = traceBranches(ctx, scene, 0, null);
  ctx.strokeStyle = theme.branchMuted;
  ctx.lineWidth = 0.75;
  ctx.stroke();

  if (nodeCodes !== null && colors.length <= MAX_BRANCH_COLORS) {
    for (let code = -1; code < colors.length; code++) {
      const traced = traceBranches(ctx, scene, 1, code);
      if (traced === 0) continue;
      branchesDrawn += traced;
      ctx.strokeStyle = code < 0 ? theme.branch : colors[code];
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else {
    branchesDrawn += traceBranches(ctx, scene, 1, null);
    ctx.strokeStyle = theme.branch;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Tip: mỗi pixel nhiều nhất một tip, rồi gom theo màu bằng sắp xếp đếm.
  const gridWidth = Math.ceil(width);
  const gridHeight = Math.ceil(height);
  ensure(scratch, gridWidth * gridHeight, tree.tipCount, colors.length);
  const { seen, drawn, sorted, bucket } = scratch;
  const { tipNode, tipCount } = tree;
  const { x, y } = positions;
  const { scaleX, scaleY, offsetX, offsetY } = view;
  let tipsVisible = 0;
  let tipsDrawn = 0;
  for (let k = 0; k < tipCount; k++) {
    if (!tipVisible[k]) continue;
    tipsVisible++;
    const node = tipNode[k];
    const px = Math.floor(offsetX + x[node] * scaleX);
    const py = Math.floor(offsetY + y[node] * scaleY);
    if (px < 0 || py < 0 || px >= gridWidth || py >= gridHeight) continue;
    const at = py * gridWidth + px;
    if (seen[at]) continue;
    seen[at] = 1;
    drawn[tipsDrawn++] = k;
    // Ô 0 dành cho tip không có giá trị (mã -1).
    bucket[(tipCodes === null ? -1 : tipCodes[k]) + 2]++;
  }
  for (let c = 1; c < colors.length + 2; c++) bucket[c] += bucket[c - 1];
  for (let n = 0; n < tipsDrawn; n++) {
    const k = drawn[n];
    sorted[bucket[(tipCodes === null ? -1 : tipCodes[k]) + 1]++] = k;
  }

  const radius = tipRadius(scene);
  let from = 0;
  for (let code = -1; code < colors.length; code++) {
    const to = bucket[code + 1];
    if (to > from) {
      ctx.fillStyle = code < 0 ? (tipCodes === null ? theme.branch : theme.missing) : colors[code];
      if (radius < 1.5) {
        const side = radius * 2;
        for (let n = from; n < to; n++) {
          const node = tipNode[sorted[n]];
          ctx.fillRect(offsetX + x[node] * scaleX - radius, offsetY + y[node] * scaleY - radius, side, side);
        }
      } else {
        ctx.beginPath();
        for (let n = from; n < to; n++) {
          const node = tipNode[sorted[n]];
          const px = offsetX + x[node] * scaleX;
          const py = offsetY + y[node] * scaleY;
          ctx.moveTo(px + radius, py);
          ctx.arc(px, py, radius, 0, FULL_TURN);
        }
        ctx.fill();
      }
    }
    from = to;
  }

  ring(ctx, scene, scene.selectedTip, radius + 4, 2.5);
  if (scene.hoverTip !== scene.selectedTip) ring(ctx, scene, scene.hoverTip, radius + 3, 1.5);
  drawAxisBand(ctx, scene);
  return { tipsVisible, tipsDrawn, branchesDrawn };
}
