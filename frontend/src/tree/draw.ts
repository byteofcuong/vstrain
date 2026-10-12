import type { Guides } from "./axis";
import type { Positions } from "./layout";
import type { Tree } from "./parse";
import type { View } from "./view";

/**
 * Vẽ cây lên Canvas 2D.
 *
 * Auspice tạo khoảng 3,5 phần tử SVG cho mỗi tip và đổi thuộc tính từng phần tử khi lọc hay đổi màu. Ở đây
 * mỗi khung hình là vài path, và những gì rơi vào cùng một pixel chỉ được vẽ một lần:
 * - mỗi node trong có một đoạn nối (dọc, hoặc cung tròn) phủ từ con đầu tới con cuối, thay vì mỗi con một đoạn
 *   chồng lên nhau;
 * - trong bố cục chữ nhật, một đoạn chỉ được vẽ khi nó phủ ít nhất một pixel mà chưa đoạn nào cùng màu, cùng
 *   hàng (hoặc cùng cột) phủ tới;
 * - tip nhỏ được gom theo ô 2 × 2 pixel, và các ô kề nhau cùng màu được vẽ bằng một hình chữ nhật.
 * Số lệnh vẽ của một khung hình vì thế bị chặn bởi số pixel của canvas, không tăng mãi theo số tip.
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
  /** Số tip được thể hiện trên canvas: mỗi ô pixel có tip được tính một lần. */
  tipsDrawn: number;
  /** Số đoạn nhánh thật sự được đưa vào path (thân nhánh và đoạn nối), sau khi bỏ những đoạn trùng pixel. */
  branchesDrawn: number;
  /** Thời gian vẽ nhánh và vẽ tip của khung hình này (mili giây). */
  branchMilliseconds: number;
  tipMilliseconds: number;
}

/** Phần của Canvas 2D mà việc vẽ cây dùng tới; test thay nó bằng một bản ghi lại các lệnh vẽ. */
export type Surface = Pick<
  CanvasRenderingContext2D,
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "stroke"
  | "fill"
  | "fillRect"
  | "fillText"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "font"
  | "textAlign"
  | "textBaseline"
>;

/** Bộ đệm dùng lại giữa các khung hình, để mỗi lần vẽ không cấp phát mảng mới. */
export interface Scratch {
  /** Với mỗi ô của lưới tip: 0 là trống, còn lại là mã màu của tip chiếm ô đó, cộng 2. */
  cells: Int16Array;
  /** Danh sách đang gom (tip, hoặc đoạn ô liền nhau) và thứ tự của nó sau khi xếp theo màu. */
  items: Int32Array;
  lengths: Int32Array;
  sorted: Int32Array;
  bucket: Int32Array;
  /** Với mỗi node trong: khoảng (theo chiều xếp tip) mà các con đang xét của nó trải ra. */
  low: Float32Array;
  high: Float32Array;
  /** Mỗi hàng pixel một dãy bit, mỗi bit một pixel đã có thân nhánh đi qua trong lượt vẽ hiện tại. */
  rowBits: Uint32Array;
  /** Lượt vẽ gần nhất đã dùng tới hàng này; khác lượt hiện tại nghĩa là dãy bit của hàng còn là của lượt cũ. */
  rowPass: Int32Array;
  /** Như trên, cho từng cột pixel và các đoạn nối dọc. */
  columnBits: Uint32Array;
  columnPass: Int32Array;
  pass: number;
  /** Các node xếp theo mã màu của nhánh, và vị trí kết thúc của từng mã trong danh sách đó. */
  byCode: Int32Array;
  codeEnd: Int32Array;
}

export function createScratch(): Scratch {
  return {
    cells: new Int16Array(0),
    items: new Int32Array(0),
    lengths: new Int32Array(0),
    sorted: new Int32Array(0),
    bucket: new Int32Array(0),
    low: new Float32Array(0),
    high: new Float32Array(0),
    rowBits: new Uint32Array(0),
    rowPass: new Int32Array(0),
    columnBits: new Uint32Array(0),
    columnPass: new Int32Array(0),
    pass: 0,
    byCode: new Int32Array(0),
    codeEnd: new Int32Array(0),
  };
}

const FULL_TURN = 2 * Math.PI;
const QUARTER_TURN = Math.PI / 2;
/** Đoạn ngắn hơn mức này (pixel) thì không nhìn thấy được và được bỏ qua. */
const TINY = 0.25;
/** Nét nằm ngoài khung nhìn quá mức này (pixel) thì không hiện ra, kể cả khi tính bề dày của nét. */
const OUTSIDE = 2;
/** Tô màu nhánh theo cột chỉ khi cột có ít giá trị: mỗi màu là một lượt duyệt qua mọi node. */
export const MAX_BRANCH_COLORS = 32;
/** Chiều cao dải ghi nhãn trục ở đáy canvas (bố cục chữ nhật). */
export const AXIS_BAND = 24;
/** Tip có bán kính dưới mức này được vẽ thành ô vuông trên lưới 2 × 2 pixel thay vì hình tròn. */
const SMALL_TIP = 1.5;

/** Bán kính của tip theo khoảng cách giữa hai tip kề nhau trên màn hình. */
export function tipRadius(scene: Pick<Scene, "tree" | "positions" | "view">): number {
  const { tree, positions, view } = scene;
  const spacing =
    positions.layout === "rect"
      ? view.scaleY / Math.max(1, tree.tipCount - 1)
      : (Math.PI * view.scaleX) / Math.max(1, tree.tipCount);
  return Math.min(4.5, Math.max(1, spacing * 0.4));
}

/**
 * Với mỗi node trong, tìm khoảng mà các con có trạng thái `visible` của nó trải ra theo chiều xếp tip (toạ độ y
 * trong bố cục chữ nhật, góc trong bố cục toả tròn). Đoạn nối của node đó phủ đúng khoảng này.
 */
function childExtents(scene: Scene, scratch: Scratch, visible: 0 | 1): void {
  const { tree, positions, nodeVisible } = scene;
  const { parent, nodeCount } = tree;
  const across = positions.angle ?? positions.y;
  if (scratch.low.length < nodeCount) {
    scratch.low = new Float32Array(nodeCount);
    scratch.high = new Float32Array(nodeCount);
  }
  const { low, high } = scratch;
  low.fill(Infinity, 0, nodeCount);
  high.fill(-Infinity, 0, nodeCount);
  for (let i = 1; i < nodeCount; i++) {
    if (nodeVisible[i] !== visible) continue;
    const up = parent[i];
    const at = across[i];
    if (at < low[up]) low[up] = at;
    if (at > high[up]) high[up] = at;
  }
}

function clampIndex(value: number, count: number): number {
  const index = Math.floor(value);
  return index < 0 ? 0 : index >= count ? count - 1 : index;
}

/**
 * Đánh dấu các bit từ `first` tới `last` (tính cả hai đầu) của dãy bit bắt đầu ở từ `base`. Trả `true` nếu có ít
 * nhất một bit trước đó chưa được đánh dấu, tức đoạn này phủ thêm pixel mới và cần được vẽ.
 */
export function claimBits(bits: Uint32Array, base: number, first: number, last: number): boolean {
  const firstWord = first >> 5;
  const lastWord = last >> 5;
  let fresh = false;
  for (let word = firstWord; word <= lastWord; word++) {
    // Mặt nạ là số nguyên 32 bit có dấu (-1 là cả 32 bit), cắt bớt ở từ đầu và từ cuối của đoạn.
    let mask = -1;
    if (word === firstWord) mask &= -1 << (first & 31);
    if (word === lastWord) mask &= -1 >>> (31 - (last & 31));
    const current = bits[base + word] | 0;
    if ((current & mask) !== mask) {
      fresh = true;
      bits[base + word] = current | mask;
    }
  }
  return fresh;
}

/** Chuẩn bị các dãy bit cho một lượt vẽ nhánh mới trên canvas `columns` × `rows` pixel; trả về số của lượt. */
function beginCoverage(scratch: Scratch, rows: number, columns: number): number {
  const rowWords = (columns + 31) >> 5;
  const columnWords = (rows + 31) >> 5;
  if (scratch.rowBits.length < rows * rowWords) scratch.rowBits = new Uint32Array(rows * rowWords);
  if (scratch.rowPass.length < rows) scratch.rowPass = new Int32Array(rows);
  if (scratch.columnBits.length < columns * columnWords) scratch.columnBits = new Uint32Array(columns * columnWords);
  if (scratch.columnPass.length < columns) scratch.columnPass = new Int32Array(columns);
  // Không xoá cả bảng ở mỗi lượt (mỗi màu nhánh là một lượt): hàng nào được dùng tới mới xoá, khi số lượt ghi
  // ở hàng đó khác lượt hiện tại.
  scratch.pass += 1;
  return scratch.pass;
}

/** Phần của mặt phẳng cực (quanh tâm cây) mà khung nhìn chạm tới. */
export interface Sector {
  /** Khoảng cách nhỏ nhất và lớn nhất từ tâm tới một điểm của khung nhìn (pixel). */
  nearest: number;
  farthest: number;
  /** Góc bắt đầu và độ mở (radian) của hình quạt chứa khung nhìn; độ mở 2π khi tâm nằm trong khung nhìn. */
  from: number;
  sweep: number;
}

/** Hình quạt nhỏ nhất quanh tâm (centerX, centerY) chứa khung nhìn [0, width] × [0, height]. */
export function visibleSector(centerX: number, centerY: number, width: number, height: number): Sector {
  const farthest = Math.max(
    Math.hypot(centerX, centerY),
    Math.hypot(width - centerX, centerY),
    Math.hypot(centerX, height - centerY),
    Math.hypot(width - centerX, height - centerY),
  );
  const outsideX = centerX < 0 ? -centerX : centerX > width ? centerX - width : 0;
  const outsideY = centerY < 0 ? -centerY : centerY > height ? centerY - height : 0;
  if (outsideX === 0 && outsideY === 0) return { nearest: 0, farthest, from: 0, sweep: FULL_TURN };

  // Tâm nằm ngoài: khung nhìn chắn một góc nhỏ hơn nửa vòng, giữa hai góc xa nhau nhất trong bốn góc của nó,
  // tính lệch so với hướng từ tâm tới giữa khung nhìn.
  const toward = Math.atan2(height / 2 - centerY, width / 2 - centerX);
  let least = Infinity;
  let most = -Infinity;
  for (const cornerX of [0, width]) {
    for (const cornerY of [0, height]) {
      let offset = Math.atan2(cornerY - centerY, cornerX - centerX) - toward;
      if (offset > Math.PI) offset -= FULL_TURN;
      else if (offset < -Math.PI) offset += FULL_TURN;
      if (offset < least) least = offset;
      if (offset > most) most = offset;
    }
  }
  return { nearest: Math.hypot(outsideX, outsideY), farthest, from: toward + least, sweep: most - least };
}

/** Đưa hiệu của hai góc về khoảng [0, 2π). */
function turnFrom(angle: number, from: number): number {
  const offset = angle - from;
  return offset - Math.floor(offset / FULL_TURN) * FULL_TURN;
}

/**
 * Xếp các node theo mã màu vào `scratch.byCode` (cùng mã thì giữ thứ tự trong cây), để mỗi lượt màu chỉ duyệt
 * các node của màu đó thay vì cả cây. Trả về mảng mốc: các node mang mã `code` nằm từ `ends[code]` (hoặc 0 với mã
 * -1) tới trước `ends[code + 1]`. Node có mã ngoài bảng màu không được xếp vào đâu.
 */
function groupByCode(scene: Scene, scratch: Scratch, nodeCodes: Int32Array): Int32Array {
  const { nodeCount } = scene.tree;
  // Mã -1 (không có giá trị) đứng ở ngăn 0, mã c ở ngăn c + 1.
  const slots = scene.colors.length + 1;
  if (scratch.byCode.length < nodeCount) scratch.byCode = new Int32Array(nodeCount);
  if (scratch.codeEnd.length < slots + 1) scratch.codeEnd = new Int32Array(slots + 1);
  const { byCode, codeEnd } = scratch;
  codeEnd.fill(0, 0, slots + 1);
  for (let i = 0; i < nodeCount; i++) {
    const slot = nodeCodes[i] + 1;
    if (slot >= 0 && slot < slots) codeEnd[slot + 1]++;
  }
  for (let slot = 1; slot <= slots; slot++) codeEnd[slot] += codeEnd[slot - 1];
  // Lúc này `codeEnd[s]` là vị trí bắt đầu của ngăn s; sau vòng dưới nó thành vị trí kết thúc.
  for (let i = 0; i < nodeCount; i++) {
    const slot = nodeCodes[i] + 1;
    if (slot >= 0 && slot < slots) byCode[codeEnd[slot]++] = i;
  }
  return codeEnd;
}

/**
 * Đưa vào path các nhánh có trạng thái `visible` của các node `nodes[start]` tới `nodes[end - 1]` (của các node
 * từ `start` tới `end - 1` khi `nodes` là `null`): thân nhánh của từng node rồi tới đoạn nối của từng node trong.
 * Thân nhánh mang màu của node con, đoạn nối mang màu của node cha. Phải gọi `childExtents` cho cùng trạng thái
 * `visible` trước đó.
 */
function traceBranches(
  ctx: Surface,
  scene: Scene,
  scratch: Scratch,
  visible: 0 | 1,
  nodes: Int32Array | null,
  start: number,
  end: number,
): number {
  const { tree, positions, view, width, height, nodeVisible } = scene;
  const { parent } = tree;
  const { x, y, along, angle } = positions;
  const { scaleX, scaleY, offsetX, offsetY } = view;
  const { low, high } = scratch;
  let count = 0;

  ctx.beginPath();

  if (angle === null) {
    const rows = Math.max(1, Math.ceil(height));
    const columns = Math.max(1, Math.ceil(width));
    const rowWords = (columns + 31) >> 5;
    const columnWords = (rows + 31) >> 5;
    const pass = beginCoverage(scratch, rows, columns);
    const { rowBits, rowPass, columnBits, columnPass } = scratch;

    // Thân nhánh: đoạn ngang từ vị trí của cha tới vị trí của node, ở hàng của node.
    for (let k = start; k < end; k++) {
      const i = nodes === null ? k : nodes[k];
      // Gốc không có thân nhánh.
      if (i === 0 || nodeVisible[i] !== visible) continue;
      const py = offsetY + y[i] * scaleY;
      if (py < -1 || py > height + 1) continue;
      const x0 = offsetX + x[parent[i]] * scaleX;
      const x1 = offsetX + x[i] * scaleX;
      const from = x0 < x1 ? x0 : x1;
      const to = x0 < x1 ? x1 : x0;
      if (to < 0 || from > width || to - from < TINY) continue;
      const row = clampIndex(py, rows);
      const base = row * rowWords;
      if (rowPass[row] !== pass) {
        rowBits.fill(0, base, base + rowWords);
        rowPass[row] = pass;
      }
      if (!claimBits(rowBits, base, clampIndex(from, columns), clampIndex(to, columns))) continue;
      ctx.moveTo(x0, py);
      ctx.lineTo(x1, py);
      count++;
    }

    // Đoạn nối: một đoạn dọc ở vị trí của node trong, phủ từ con trên cùng tới con dưới cùng.
    for (let k = start; k < end; k++) {
      const p = nodes === null ? k : nodes[k];
      if (!(low[p] <= high[p])) continue;
      const px = offsetX + x[p] * scaleX;
      if (px < -1 || px > width + 1) continue;
      const from = offsetY + (low[p] < y[p] ? low[p] : y[p]) * scaleY;
      const to = offsetY + (high[p] > y[p] ? high[p] : y[p]) * scaleY;
      if (to < 0 || from > height || to - from < TINY) continue;
      const column = clampIndex(px, columns);
      const base = column * columnWords;
      if (columnPass[column] !== pass) {
        columnBits.fill(0, base, base + columnWords);
        columnPass[column] = pass;
      }
      if (!claimBits(columnBits, base, clampIndex(from, rows), clampIndex(to, rows))) continue;
      ctx.moveTo(px, from);
      ctx.lineTo(px, to);
      count++;
    }
    return count;
  }

  const centerX = offsetX + 0.5 * scaleX;
  const centerY = offsetY + 0.5 * scaleY;
  const unit = 0.5 * scaleX;
  // Chỉ phần của cây nằm trong hình quạt chứa khung nhìn mới cần xét. Trong hình quạt đó, mặt phẳng được chia
  // thành ô cực: mỗi "tia" rộng một pixel ở chỗ xa tâm nhất mà một nhánh có thể hiện ra (mép xa của khung nhìn,
  // hoặc vòng ngoài cùng của cây nếu nó gần hơn), mỗi "vòng" dày một pixel. Một thân nhánh chiếm vài vòng trên
  // một tia, một đoạn nối chiếm vài tia trên một vòng; như ở bố cục chữ nhật, đoạn nào không phủ thêm ô nào
  // thì bỏ.
  const sector = visibleSector(centerX, centerY, width, height);
  const { nearest, farthest, from: sectorFrom, sweep } = sector;
  const perRay = 1 / Math.max(1, Math.min(farthest, unit));
  const rays = Math.ceil(sweep / perRay) + 1;
  const rings = Math.ceil(farthest - nearest) + 1;
  const rayWords = (rings + 31) >> 5;
  const ringWords = (rays + 31) >> 5;
  const pass = beginCoverage(scratch, rays, rings);
  const { rowBits: rayBits, rowPass: rayPass, columnBits: ringBits, columnPass: ringPass } = scratch;
  // Hình quạt rộng hơn khung nhìn (nó là cả vòng tròn khi tâm cây nằm trong khung nhìn). Khi cây không nằm trọn
  // trong khung nhìn, từng nét còn được so với bốn cạnh của khung nhìn, nới ra `OUTSIDE` pixel.
  const clipped = centerX - unit < 0 || centerX + unit > width || centerY - unit < 0 || centerY + unit > height;
  const left = -OUTSIDE;
  const right = width + OUTSIDE;
  const top = -OUTSIDE;
  const bottom = height + OUTSIDE;

  // Thân nhánh: đoạn dọc theo bán kính, từ vòng tròn của cha ra tới node, ở góc của node.
  for (let k = start; k < end; k++) {
    const i = nodes === null ? k : nodes[k];
    if (i === 0 || nodeVisible[i] !== visible) continue;
    const turn = turnFrom(angle[i], sectorFrom);
    if (turn > sweep) continue;
    const inner = along[parent[i]] * unit;
    const outer = along[i] * unit;
    const near = inner < outer ? inner : outer;
    const far = inner < outer ? outer : inner;
    if (far < nearest || near > farthest || far - near < TINY) continue;
    const x1 = offsetX + x[i] * scaleX;
    const y1 = offsetY + y[i] * scaleY;
    // Điểm đầu nằm trên cùng tia với node, ở bán kính của cha; không cần tính sin, cos.
    const ratio = along[i] > 0 ? along[parent[i]] / along[i] : 0;
    const x0 = centerX + (x1 - centerX) * ratio;
    const y0 = centerY + (y1 - centerY) * ratio;
    // Hai đầu cùng nằm ngoài một cạnh của khung nhìn thì cả đoạn thẳng nằm ngoài.
    if (
      clipped &&
      ((x0 < left && x1 < left) || (x0 > right && x1 > right) || (y0 < top && y1 < top) || (y0 > bottom && y1 > bottom))
    ) {
      continue;
    }
    const ray = clampIndex(turn / perRay, rays);
    const base = ray * rayWords;
    if (rayPass[ray] !== pass) {
      rayBits.fill(0, base, base + rayWords);
      rayPass[ray] = pass;
    }
    if (!claimBits(rayBits, base, clampIndex(near - nearest, rings), clampIndex(far - nearest, rings))) continue;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    count++;
  }

  // Đoạn nối: một cung ở bán kính của node trong, phủ từ con có góc nhỏ nhất tới con có góc lớn nhất.
  for (let k = start; k < end; k++) {
    const p = nodes === null ? k : nodes[k];
    if (!(low[p] <= high[p])) continue;
    const radius = along[p] * unit;
    if (radius < nearest - 1 || radius > farthest + 1) continue;
    const from = low[p] < angle[p] ? low[p] : angle[p];
    const to = high[p] > angle[p] ? high[p] : angle[p];
    const span = to - from;
    if (span * radius < TINY) continue;
    // Phần của cung nằm trong hình quạt: bắt đầu ở trong, hoặc bắt đầu ở ngoài rồi vòng qua mốc 0 để vào.
    const turn = turnFrom(from, sectorFrom);
    let first: number;
    let last: number;
    if (turn <= sweep) {
      first = turn;
      last = turn + span < sweep ? turn + span : sweep;
    } else if (turn + span >= FULL_TURN) {
      first = 0;
      last = turn + span - FULL_TURN < sweep ? turn + span - FULL_TURN : sweep;
    } else {
      continue;
    }
    // Cung vừa bắt đầu trong hình quạt vừa vòng lại vào nó lần nữa (cung gần trọn vòng, hình quạt hẹp) chiếm
    // hai đoạn tia rời nhau; trường hợp hiếm này luôn được vẽ, không ghi vào bảng.
    const twice = turn <= sweep && sweep < FULL_TURN && turn + span >= FULL_TURN;
    if (!twice) {
      const ring = clampIndex(radius - nearest, rings);
      const base = ring * ringWords;
      if (ringPass[ring] !== pass) {
        ringBits.fill(0, base, base + ringWords);
        ringPass[ring] = pass;
      }
      if (!claimBits(ringBits, base, clampIndex(first / perRay, rays), clampIndex(last / perRay, rays))) continue;
    }
    const fromX = centerX + radius * Math.cos(from);
    const fromY = centerY + radius * Math.sin(from);
    if (clipped) {
      // Hộp bao của cung: hai đầu mút, cùng điểm thấp nhất, trái nhất, cao nhất của vòng tròn nếu cung đi qua
      // (góc π/2, π, 3π/2; cung không đi qua góc 0 vì góc của mọi node nằm trong [0, 2π)). Cung bị loại ở đây
      // đã ghi ô của nó vào bảng, nhưng nó nằm ngoài khung nhìn ít nhất `OUTSIDE` pixel trong khi một ô chỉ
      // rộng một pixel, nên cung nào bị bỏ vì các ô đó cũng nằm ngoài khung nhìn.
      const toX = centerX + radius * Math.cos(to);
      const toY = centerY + radius * Math.sin(to);
      const minX = from <= Math.PI && to >= Math.PI ? centerX - radius : fromX < toX ? fromX : toX;
      const maxX = fromX > toX ? fromX : toX;
      const maxY = from <= QUARTER_TURN && to >= QUARTER_TURN ? centerY + radius : fromY > toY ? fromY : toY;
      const minY = from <= 3 * QUARTER_TURN && to >= 3 * QUARTER_TURN ? centerY - radius : fromY < toY ? fromY : toY;
      if (maxX < left || minX > right || maxY < top || minY > bottom) continue;
    }
    ctx.moveTo(fromX, fromY);
    ctx.arc(centerX, centerY, radius, from, to);
    count++;
  }
  return count;
}

function drawBranches(ctx: Surface, scene: Scene, scratch: Scratch): number {
  const { nodeCodes, colors, theme } = scene;
  const { nodeCount } = scene.tree;
  // Đầu vuông để chỗ đoạn dọc gặp đoạn ngang không hở một góc.
  ctx.lineCap = "square";

  // Nhánh mờ trước, nhánh đang hiện đè lên trên.
  childExtents(scene, scratch, 0);
  let count = traceBranches(ctx, scene, scratch, 0, null, 0, nodeCount);
  ctx.strokeStyle = theme.branchMuted;
  ctx.lineWidth = 0.75;
  ctx.stroke();

  childExtents(scene, scratch, 1);
  ctx.lineWidth = 1;
  if (nodeCodes !== null && colors.length <= MAX_BRANCH_COLORS) {
    // Mỗi màu một lượt vẽ, bắt đầu từ các nhánh không có giá trị (mã -1).
    const ends = groupByCode(scene, scratch, nodeCodes);
    let start = 0;
    for (let code = -1; code < colors.length; code++) {
      const end = ends[code + 1];
      const traced = end > start ? traceBranches(ctx, scene, scratch, 1, scratch.byCode, start, end) : 0;
      start = end;
      if (traced === 0) continue;
      count += traced;
      ctx.strokeStyle = code < 0 ? theme.branch : colors[code];
      ctx.stroke();
    }
  } else {
    count += traceBranches(ctx, scene, scratch, 1, null, 0, nodeCount);
    ctx.strokeStyle = theme.branch;
    ctx.stroke();
  }
  return count;
}

/** Xếp `count` mục theo mã màu bằng sắp xếp đếm; `slotOf(n)` là mã màu cộng 2 của mục thứ n. Trả về mảng mốc. */
function sortBySlot(scratch: Scratch, count: number, slots: number, slotOf: (n: number) => number): Int32Array {
  const { sorted, bucket } = scratch;
  bucket.fill(0, 0, slots + 1);
  for (let n = 0; n < count; n++) bucket[slotOf(n) + 1]++;
  for (let slot = 1; slot <= slots; slot++) bucket[slot] += bucket[slot - 1];
  // Sau vòng này `bucket[s]` là vị trí kết thúc của các mục có mã s.
  for (let n = 0; n < count; n++) sorted[bucket[slotOf(n)]++] = n;
  return bucket;
}

function drawTips(ctx: Surface, scene: Scene, scratch: Scratch, radius: number): [visible: number, drawn: number] {
  const { tree, positions, view, width, height, tipVisible, tipCodes, colors, theme } = scene;
  const { tipNode, tipCount } = tree;
  const { x, y } = positions;
  const { scaleX, scaleY, offsetX, offsetY } = view;

  // Mỗi ô của lưới nhiều nhất một tip. Tip nhỏ được vẽ thành ô vuông 2 pixel nên ô là 2 × 2 pixel; tip lớn hơn
  // nằm thưa, mỗi ô là một pixel.
  const small = radius < SMALL_TIP;
  const shift = small ? 1 : 0;
  const gridWidth = (Math.ceil(width) >> shift) + 1;
  const gridHeight = (Math.ceil(height) >> shift) + 1;
  // Mã màu cộng 2 làm "ngăn": ngăn 1 là tip không có giá trị (mã -1), ngăn 0 để trống cho ô không có tip.
  const slots = colors.length + 2;
  if (scratch.cells.length < gridWidth * gridHeight) scratch.cells = new Int16Array(gridWidth * gridHeight);
  else scratch.cells.fill(0, 0, gridWidth * gridHeight);
  if (scratch.items.length < tipCount) {
    scratch.items = new Int32Array(tipCount);
    scratch.lengths = new Int32Array(tipCount);
    scratch.sorted = new Int32Array(tipCount);
  }
  if (scratch.bucket.length < slots + 1) scratch.bucket = new Int32Array(slots + 1);
  const { cells, items, lengths, sorted } = scratch;

  let tipsVisible = 0;
  let tipsDrawn = 0;
  for (let k = 0; k < tipCount; k++) {
    if (!tipVisible[k]) continue;
    tipsVisible++;
    const node = tipNode[k];
    const px = offsetX + x[node] * scaleX;
    const py = offsetY + y[node] * scaleY;
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const at = (py >> shift) * gridWidth + (px >> shift);
    if (cells[at] !== 0) continue;
    cells[at] = (tipCodes === null ? -1 : tipCodes[k]) + 2;
    items[tipsDrawn++] = k;
  }
  const colorOf = (slot: number) =>
    slot === 1 ? (tipCodes === null ? theme.branch : theme.missing) : colors[slot - 2];

  if (!small) {
    // Tip đủ lớn: mỗi tip một hình tròn ở đúng vị trí của nó, gom theo màu để mỗi màu tô một lần.
    const ends = sortBySlot(scratch, tipsDrawn, slots, (n) => (tipCodes === null ? -1 : tipCodes[items[n]]) + 2);
    let from = 0;
    for (let slot = 1; slot < slots; slot++) {
      const to = ends[slot];
      if (to > from) {
        ctx.fillStyle = colorOf(slot);
        ctx.beginPath();
        for (let n = from; n < to; n++) {
          const node = tipNode[items[sorted[n]]];
          const px = offsetX + x[node] * scaleX;
          const py = offsetY + y[node] * scaleY;
          ctx.moveTo(px + radius, py);
          ctx.arc(px, py, radius, 0, FULL_TURN);
        }
        ctx.fill();
      }
      from = to;
    }
    return [tipsVisible, tipsDrawn];
  }

  // Tip nhỏ: quét lưới theo từng hàng, mỗi dãy ô liền nhau cùng màu thành một hình chữ nhật. Số lệnh vẽ vì thế
  // bị chặn bởi số ô của lưới chứ không theo số tip.
  let runs = 0;
  for (let row = 0; row < gridHeight; row++) {
    let at = row * gridWidth;
    const end = at + gridWidth;
    while (at < end) {
      const slot = cells[at];
      if (slot === 0) {
        at++;
        continue;
      }
      let stop = at + 1;
      while (stop < end && cells[stop] === slot) stop++;
      items[runs] = at;
      lengths[runs] = stop - at;
      runs++;
      at = stop;
    }
  }
  const ends = sortBySlot(scratch, runs, slots, (n) => cells[items[n]]);
  const side = 1 << shift;
  let from = 0;
  for (let slot = 1; slot < slots; slot++) {
    const to = ends[slot];
    if (to > from) {
      ctx.fillStyle = colorOf(slot);
      for (let n = from; n < to; n++) {
        const run = sorted[n];
        const at = items[run];
        const column = at % gridWidth;
        ctx.fillRect(column << shift, ((at - column) / gridWidth) << shift, lengths[run] << shift, side);
      }
    }
    from = to;
  }
  return [tipsVisible, tipsDrawn];
}

function ring(ctx: Surface, scene: Scene, tip: number, radius: number, lineWidth: number): void {
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

function drawGuides(ctx: Surface, scene: Scene): void {
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
function drawAxisBand(ctx: Surface, scene: Scene): void {
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
export function drawTree(ctx: Surface, scene: Scene, scratch: Scratch): DrawStats {
  const { width, height, theme } = scene;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = "butt";
  drawGuides(ctx, scene);

  const started = performance.now();
  const branchesDrawn = drawBranches(ctx, scene, scratch);
  const branchesDone = performance.now();
  const radius = tipRadius(scene);
  const [tipsVisible, tipsDrawn] = drawTips(ctx, scene, scratch, radius);
  const tipsDone = performance.now();

  ring(ctx, scene, scene.selectedTip, radius + 4, 2.5);
  if (scene.hoverTip !== scene.selectedTip) ring(ctx, scene, scene.hoverTip, radius + 3, 1.5);
  drawAxisBand(ctx, scene);
  return {
    tipsVisible,
    tipsDrawn,
    branchesDrawn,
    branchMilliseconds: branchesDone - started,
    tipMilliseconds: tipsDone - branchesDone,
  };
}
