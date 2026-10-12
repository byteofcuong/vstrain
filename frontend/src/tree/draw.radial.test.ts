import { describe, expect, it } from "vitest";

import { visibleSector, type Scene } from "./draw";
import { draw, scene, type Recorder } from "./draw.testkit";
import { randomTree } from "./fixtures";
import { parseTree, type Tree, type TreeFile } from "./parse";

const FULL_TURN = 2 * Math.PI;
/** Nhánh ngắn hơn một phần tư pixel không được vẽ. */
const QUARTER = 0.25;
const close = (value: number) => Math.round(value * 1000) / 1000;
/** Góc `angle` tính từ góc `from`, đưa về [0, 2π). */
const turnFrom = (angle: number, from: number) => (((angle - from) % FULL_TURN) + FULL_TURN) % FULL_TURN;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Tập pixel mà một loạt nét đi qua, lấy mẫu mỗi phần tư pixel dọc theo nét. Pixel ngoài `clip` bị bỏ. */
class Raster {
  private static readonly SHIFT = 4096;
  private static readonly WIDE = 16384;
  readonly pixels = new Set<number>();

  constructor(private readonly clip: Box) {}

  private plot(x: number, y: number): void {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < this.clip.left || px >= this.clip.right || py < this.clip.top || py >= this.clip.bottom) return;
    this.pixels.add((py + Raster.SHIFT) * Raster.WIDE + px + Raster.SHIFT);
  }

  line(x0: number, y0: number, x1: number, y1: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / QUARTER));
    for (let n = 0; n <= steps; n++) this.plot(x0 + ((x1 - x0) * n) / steps, y0 + ((y1 - y0) * n) / steps);
  }

  arc(centerX: number, centerY: number, radius: number, from: number, to: number): void {
    const steps = Math.max(1, Math.ceil(((to - from) * radius) / QUARTER));
    for (let n = 0; n <= steps; n++) {
      const at = from + ((to - from) * n) / steps;
      this.plot(centerX + radius * Math.cos(at), centerY + radius * Math.sin(at));
    }
  }

  /** Số pixel của tập này nằm trong `inside` mà quanh nó, trong vòng `reach` pixel, không có pixel nào của `other`. */
  farFrom(other: Raster, reach: number, inside: Box): number {
    let count = 0;
    for (const pixel of this.pixels) {
      const px = (pixel % Raster.WIDE) - Raster.SHIFT;
      const py = Math.floor(pixel / Raster.WIDE) - Raster.SHIFT;
      if (px < inside.left || px >= inside.right || py < inside.top || py >= inside.bottom) continue;
      let found = false;
      for (let dy = -reach; dy <= reach && !found; dy++) {
        for (let dx = -reach; dx <= reach && !found; dx++) found = other.pixels.has(pixel + dy * Raster.WIDE + dx);
      }
      if (!found) count++;
    }
    return count;
  }
}

const grown = (box: Box, by: number): Box => ({
  left: box.left - by,
  top: box.top - by,
  right: box.right + by,
  bottom: box.bottom + by,
});

interface Frame {
  centerX: number;
  centerY: number;
  /** Bán kính (pixel) của vòng tròn ngoài cùng của cây. */
  unit: number;
  viewport: Box;
}

function frameOf(drawn: Scene): Frame {
  return {
    centerX: drawn.view.offsetX + 0.5 * drawn.view.scaleX,
    centerY: drawn.view.offsetY + 0.5 * drawn.view.scaleY,
    unit: 0.5 * drawn.view.scaleX,
    viewport: { left: 0, top: 0, right: Math.ceil(drawn.width), bottom: Math.ceil(drawn.height) },
  };
}

interface Stem {
  angle: number;
  inner: number;
  outer: number;
}

interface Bend {
  radius: number;
  from: number;
  to: number;
}

/**
 * Mọi nhánh giữa các node được chọn, tính thẳng từ vị trí của node: chưa bỏ bớt, chưa cắt theo khung nhìn. Đây
 * là "đáp án" để so với những gì bộ vẽ thật sự đưa ra. Với `painted`, chỉ lấy thân của các node mà nó nhận và
 * cung của các node trong mà nó nhận: đó là các nhánh mang cùng một màu.
 */
function branchesOf(
  drawn: Scene,
  chosen: (node: number) => boolean,
  painted: (node: number) => boolean = () => true,
): { stems: Stem[]; bends: Bend[] } {
  const { tree, positions } = drawn;
  const { unit } = frameOf(drawn);
  const angle = positions.angle!;
  const low = new Float64Array(tree.nodeCount).fill(Infinity);
  const high = new Float64Array(tree.nodeCount).fill(-Infinity);
  const stems: Stem[] = [];
  for (let i = 1; i < tree.nodeCount; i++) {
    if (!chosen(i)) continue;
    const up = tree.parent[i];
    low[up] = Math.min(low[up], angle[i]);
    high[up] = Math.max(high[up], angle[i]);
    const inner = positions.along[up] * unit;
    const outer = positions.along[i] * unit;
    if (painted(i) && Math.abs(outer - inner) >= QUARTER) stems.push({ angle: angle[i], inner, outer });
  }
  const bends: Bend[] = [];
  for (let p = 0; p < tree.nodeCount; p++) {
    if (!(low[p] <= high[p]) || !painted(p)) continue;
    const radius = positions.along[p] * unit;
    const from = Math.min(low[p], angle[p]);
    const to = Math.max(high[p], angle[p]);
    if ((to - from) * radius >= QUARTER) bends.push({ radius, from, to });
  }
  return { stems, bends };
}

function rasterOf(frame: Frame, branches: { stems: Stem[]; bends: Bend[] }, clip: Box): Raster {
  const raster = new Raster(clip);
  const { centerX, centerY } = frame;
  for (const stem of branches.stems) {
    const cos = Math.cos(stem.angle);
    const sin = Math.sin(stem.angle);
    raster.line(
      centerX + stem.inner * cos,
      centerY + stem.inner * sin,
      centerX + stem.outer * cos,
      centerY + stem.outer * sin,
    );
  }
  for (const bend of branches.bends) raster.arc(centerX, centerY, bend.radius, bend.from, bend.to);
  return raster;
}

/** Những nét nhánh mà bộ vẽ đã đưa ra, có thể chỉ lấy một màu. */
function strokesOf(recorder: Recorder, style?: string) {
  const wanted = (item: { style: string }) => style === undefined || item.style === style;
  return {
    lines: recorder.lines.filter(wanted),
    arcs: recorder.arcs.filter((arc) => arc.kind === "stroke" && wanted(arc)),
  };
}

function rasterOfStrokes(strokes: ReturnType<typeof strokesOf>, clip: Box): Raster {
  const raster = new Raster(clip);
  for (const line of strokes.lines) raster.line(line.x0, line.y0, line.x1, line.y1);
  for (const arc of strokes.arcs) raster.arc(arc.x, arc.y, arc.radius, arc.from, arc.to);
  return raster;
}

/**
 * So những gì đã vẽ với đáp án, trong khung nhìn. Một nhánh bị bỏ nằm cách nhánh được giữ lại nhiều nhất một ô
 * cực (một pixel theo mỗi chiều), nên phép so không đòi trùng từng pixel:
 * - `shifted`: số pixel của đáp án không được vẽ đúng vào nó (nét gần nhất lệch sang pixel bên cạnh);
 * - `missing`: số pixel của đáp án không có nét vẽ nào trong vòng hai pixel;
 * - `extra`: số pixel đã vẽ không có nhánh nào của đáp án trong vòng một pixel.
 */
function compare(
  drawn: Scene,
  strokes: ReturnType<typeof strokesOf>,
  chosen: (node: number) => boolean,
  painted?: (node: number) => boolean,
) {
  const frame = frameOf(drawn);
  const near = grown(frame.viewport, 2);
  const wanted = rasterOf(frame, branchesOf(drawn, chosen, painted), near);
  const got = rasterOfStrokes(strokes, near);
  return {
    wanted: wanted.pixels.size,
    shifted: wanted.farFrom(got, 0, frame.viewport),
    missing: wanted.farFrom(got, 2, frame.viewport),
    extra: got.farFrom(wanted, 1, frame.viewport),
  };
}

describe("visibleSector", () => {
  it("is the whole circle when the centre is inside the viewport", () => {
    const sector = visibleSector(30, 40, 100, 200);

    expect(sector).toEqual({ nearest: 0, farthest: Math.hypot(70, 160), from: 0, sweep: FULL_TURN });
    // Tâm nằm ngay trên mép vẫn tính là ở trong.
    expect(visibleSector(0, 40, 100, 200).sweep).toBe(FULL_TURN);
    expect(visibleSector(100, 200, 100, 200).sweep).toBe(FULL_TURN);
  });

  it("is the wedge between the two outermost corners when the centre is to the left", () => {
    const sector = visibleSector(-100, 50, 100, 100);
    const half = Math.atan2(50, 100);

    expect(sector.nearest).toBe(100);
    expect(sector.farthest).toBeCloseTo(Math.hypot(200, 50), 9);
    expect(sector.from).toBeCloseTo(-half, 9);
    expect(sector.sweep).toBeCloseTo(2 * half, 9);
  });

  it("handles a viewport that straddles the direction where angles wrap from π to -π", () => {
    // Tâm ở bên phải khung nhìn: khung nhìn nằm quanh hướng π.
    const sector = visibleSector(200, 50, 100, 100);
    const half = Math.atan2(50, 100);

    expect(sector.nearest).toBe(100);
    expect(sector.from).toBeCloseTo(Math.PI - half, 9);
    expect(sector.sweep).toBeCloseTo(2 * half, 9);
  });

  it("measures the nearest distance to a corner when the centre is diagonally outside", () => {
    const sector = visibleSector(-30, -40, 100, 100);

    expect(sector.nearest).toBe(50);
    expect(sector.farthest).toBeCloseTo(Math.hypot(130, 140), 9);
    // Khung nhìn nằm trong góc phần tư thứ nhất tính từ tâm, giữa hai góc (100, 0) và (0, 100).
    expect(sector.from).toBeCloseTo(Math.atan2(40, 130), 9);
    expect(sector.from + sector.sweep).toBeCloseTo(Math.atan2(140, 30), 9);
  });

  it("contains every point of the viewport and no more than needed, wherever the centre is", () => {
    let state = 7;
    const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296;
    for (let n = 0; n < 300; n++) {
      const width = 20 + random() * 400;
      const height = 20 + random() * 400;
      const centerX = (random() * 3 - 1) * width;
      const centerY = (random() * 3 - 1) * height;
      const sector = visibleSector(centerX, centerY, width, height);
      const label = `centre (${centerX}, ${centerY}) in ${width} × ${height}`;

      let least = Infinity;
      let most = -Infinity;
      let nearest = Infinity;
      let farthest = -Infinity;
      // Lưới điểm phủ cả khung nhìn, gồm bốn mép và bốn góc.
      for (let row = 0; row <= 12; row++) {
        for (let column = 0; column <= 12; column++) {
          const dx = (width * column) / 12 - centerX;
          const dy = (height * row) / 12 - centerY;
          const distance = Math.hypot(dx, dy);
          nearest = Math.min(nearest, distance);
          farthest = Math.max(farthest, distance);
          expect(distance, label).toBeGreaterThanOrEqual(sector.nearest - 1e-9);
          expect(distance, label).toBeLessThanOrEqual(sector.farthest + 1e-9);
          if (sector.sweep === FULL_TURN || distance === 0) continue;
          // Cộng một lượng rất nhỏ để điểm nằm đúng trên mép đầu của hình quạt không bị tính thành gần trọn vòng.
          const turn = turnFrom(Math.atan2(dy, dx) + 1e-9, sector.from);
          least = Math.min(least, turn);
          most = Math.max(most, turn);
          expect(turn, label).toBeLessThanOrEqual(sector.sweep + 2e-9);
        }
      }
      // Không rộng hơn cần thiết: điểm xa nhất và hai mép góc của hình quạt đều chạm vào khung nhìn.
      expect(farthest, label).toBeCloseTo(sector.farthest, 9);
      if (sector.sweep === FULL_TURN) continue;
      expect(least, label).toBeLessThan(1e-8);
      expect(most, label).toBeGreaterThan(sector.sweep - 1e-8);
      expect(sector.sweep, label).toBeLessThan(Math.PI);
      // Khoảng cách gần nhất nằm trên mép khung nhìn, có thể rơi giữa hai điểm lưới.
      expect(sector.nearest, label).toBeLessThanOrEqual(nearest + 1e-9);
      expect(sector.nearest, label).toBeGreaterThan(nearest - Math.max(width, height) / 12);
    }
  });
});

/** Cây hình quạt: gốc (2000) có mỗi nhóm một node trong (2010), mỗi node trong có số tip đã cho (2020). */
function fanTree(groups: number[]): Tree {
  const file: TreeFile = {
    nodeCount: 0,
    tipCount: 0,
    name: [],
    parent: [],
    div: [],
    numDate: [],
    numDateLower: [],
    numDateUpper: [],
    tipNode: [],
  };
  const add = (parent: number, date: number, name: string): number => {
    file.parent.push(parent);
    file.numDate.push(date);
    file.numDateLower.push(date);
    file.numDateUpper.push(date);
    file.div.push(0);
    file.name.push(name);
    return file.name.length - 1;
  };
  add(-1, 2000, "root");
  groups.forEach((tips, group) => {
    const inner = add(0, 2010, `G${group}`);
    for (let k = 0; k < tips; k++) file.tipNode.push(add(inner, 2020, `g${group}t${k}`));
  });
  file.nodeCount = file.name.length;
  file.tipCount = file.tipNode.length;
  return parseTree(file);
}

describe("drawTree, radial layout seen from the side", () => {
  // Khung nhìn 100 × 120 pixel nằm bên phải tâm cây, cách tâm 100 pixel: tâm ở (-100, 60). Node trong ở bán
  // kính 150 pixel, tip ở bán kính 300 pixel, 40 tip xếp đều quanh vòng tròn. Khung nhìn chắn một góc ±0,54
  // radian quanh hướng 0, tức là chứa hướng của tip 0–3 và tip 37–39. Thân của tip 3 và tip 37 bắt đầu ở bán
  // kính 150, khi đó đã ra khỏi mép dưới và mép trên của khung nhìn (y = 128 và y = -8), nên không được vẽ.
  const side = { view: { scaleX: 600, scaleY: 600, offsetX: -400, offsetY: -240 }, width: 100, height: 120 };
  const step = FULL_TURN / 40;
  const tipsOf = (recorder: Recorder) =>
    recorder.lines.map((line) => Math.round(turnFrom(Math.atan2(line.y1 - 60, line.x1 + 100), 0) / step));
  const arcsOf = (recorder: Recorder) =>
    strokesOf(recorder).arcs.map((arc) => [arc.radius, arc.from, arc.to].map(close));

  it("draws an arc that starts outside the view and ends inside it", () => {
    // Nhóm đầu giữ tip 0–29, nhóm sau giữ tip 30–39. Cung của nhóm sau bắt đầu ở góc 4,71 (ngoài khung nhìn) và
    // kết thúc ở góc 6,13 (trong khung nhìn, ngay trước mốc 0).
    const { recorder, stats } = draw(scene(fanTree([30, 10]), "radial", 100, side));

    expect(arcsOf(recorder)).toEqual([
      [150, 0, close(29 * step)],
      [150, close(30 * step), close(39 * step)],
    ]);
    // Chỉ thân của các tip chạm vào khung nhìn được vẽ; thân của hai node trong hướng ra chỗ khác.
    expect(tipsOf(recorder)).toEqual([0, 1, 2, 38, 39]);
    expect(stats.branchesDrawn).toBe(7);
  });

  it("draws an arc that leaves the view on one side and comes back on the other", () => {
    // Một nhóm duy nhất: cung của nó đi gần trọn vòng, từ tip 0 tới tip 39, hai đầu đều nằm trong khung nhìn.
    const { recorder, stats } = draw(scene(fanTree([40]), "radial", 100, side));

    expect(arcsOf(recorder)).toEqual([[150, 0, close(39 * step)]]);
    expect(tipsOf(recorder)).toEqual([0, 1, 2, 38, 39]);
    expect(stats.branchesDrawn).toBe(6);
  });

  it("draws nothing for a part of the tree that the view cannot touch", () => {
    // Khung nhìn dời sang trái tâm cây (tâm ở (200, 60)): chỉ còn các tip quanh hướng π, tip 18–22.
    const left = { ...side, view: { ...side.view, offsetX: -100 } };
    const { recorder } = draw(scene(fanTree([10, 30]), "radial", 100, left));
    const tips = recorder.lines.map((line) => Math.round(turnFrom(Math.atan2(line.y1 - 60, line.x1 - 200), 0) / step));

    // Cung của nhóm đầu (tip 0–9, góc 0 tới 1,41) nằm trọn ngoài hình quạt.
    expect(arcsOf(recorder)).toEqual([[150, close(10 * step), close(39 * step)]]);
    expect(tips).toEqual([18, 19, 20, 21, 22]);
  });

  it("drops an arc whose bounding box misses the viewport although its angles are in view", () => {
    // Tâm cây nằm trong khung nhìn, sát góc trên bên trái: hình quạt là cả vòng tròn, nhưng khung nhìn chỉ thấy
    // góc phần tư dưới bên phải của cây. Nhóm đầu (tip 0–9, góc 0 tới 1,41) nằm trong góc phần tư đó; nhóm sau
    // (tip 10–39, góc 1,57 tới 6,13) có cung đi qua bên trái và phía trên tâm.
    const corner = { view: { scaleX: 600, scaleY: 600, offsetX: -295, offsetY: -295 }, width: 200, height: 200 };
    const quarter = draw(scene(fanTree([10, 30]), "radial", 100, corner));
    // Cung của nhóm sau bắt đầu ở (5, 155), đúng trên mép trái của khung nhìn, nên vẫn được vẽ.
    expect(arcsOf(quarter.recorder)).toEqual([
      [150, 0, close(9 * step)],
      [150, close(10 * step), close(39 * step)],
    ]);

    // Nhóm giữa giữ tip 22–38 (góc 3,46 tới 5,97): cung của nó đi từ (-138, -41) qua đỉnh vòng tròn tới
    // (148, -41), nằm trọn phía trên khung nhìn. Nhóm cuối chỉ có một tip nên không có cung.
    const upper = draw(scene(fanTree([22, 17, 1]), "radial", 100, corner));
    expect(arcsOf(upper.recorder)).toEqual([[150, 0, close(21 * step)]]);
  });

  // Node trong ở bán kính 130 pixel; khung nhìn cách tâm cây 100 pixel về một phía. Cung của nhóm giữa có hai đầu
  // mút nằm ngoài khung nhìn, nhưng phần giữa của nó võng vào trong 30 pixel. Hai nhóm còn lại nằm trọn ngoài.
  it.each([
    ["below", [4, 13, 23], 50, -100, 100, 50],
    ["above", [24, 13, 3], 50, 150, 100, 50],
    ["to the left of", [14, 13, 13], 150, 50, 50, 100],
  ])(
    "keeps an arc that bulges into a view %s the centre while both its ends are outside",
    (_where, groups, centerX, centerY, width, height) => {
      const view = { scaleX: 520, scaleY: 520, offsetX: centerX - 260, offsetY: centerY - 260 };
      const { recorder } = draw(scene(fanTree(groups), "radial", 100, { view, width, height }));
      const first = groups[0];
      const last = groups[0] + groups[1] - 1;

      expect(arcsOf(recorder)).toEqual([[130, close(first * step), close(last * step)]]);
    },
  );

  it("does not let an arc nearer to the centre than the viewport hide one that just reaches it", () => {
    // Gốc → A (bán kính 50) → (tip, B, tip); B (bán kính 100,5) → ba tip. Khung nhìn nằm bên trái tâm, điểm gần
    // tâm nhất của nó cách tâm 100 pixel: cung của A không tới được khung nhìn, cung của B lọt vào nửa pixel.
    const numDate = [2000, 2000 + 50 / 15, 2020, 2000 + 100.5 / 15, 2020, 2020, 2020, 2020];
    const tree = parseTree({
      nodeCount: 8,
      tipCount: 5,
      name: ["root", "A", "a0", "B", "b0", "b1", "b2", "a1"],
      parent: [-1, 0, 1, 1, 3, 3, 3, 1],
      div: [0, 0, 0, 0, 0, 0, 0, 0],
      numDate,
      numDateLower: numDate,
      numDateUpper: numDate,
      tipNode: [2, 4, 5, 6, 7],
    });
    const left = { ...side, view: { ...side.view, offsetX: -100 } };
    const { recorder } = draw(scene(tree, "radial", 100, left));

    expect(arcsOf(recorder)).toEqual([[100.5, close(FULL_TURN / 5), close((3 * FULL_TURN) / 5)]]);
  });
});

/** Cả loạt điểm nằm ngoài cùng một cạnh của khung nhìn, cách cạnh đó hơn ba pixel: nét đi qua chúng không hiện ra. */
function beside(xs: number[], ys: number[], drawn: Scene): boolean {
  const slack = 3;
  return (
    Math.max(...xs) < -slack ||
    Math.min(...xs) > drawn.width + slack ||
    Math.max(...ys) < -slack ||
    Math.min(...ys) > drawn.height + slack
  );
}

/**
 * Cây bậc thang: gốc → G → (P, một tip); P → (một tip, C); C → hai tip. Cung của C nằm trọn trong khoảng góc mà
 * cung của G và cung của P cộng lại đã phủ. Ba node trong ở các ngày đã cho; gốc ở 2000, bốn tip ở 2020.
 */
function ladderTree(dates: [g: number, p: number, c: number]): Tree {
  const [g, p, c] = dates;
  const numDate = [2000, g, p, 2020, c, 2020, 2020, 2020];
  return parseTree({
    nodeCount: 8,
    tipCount: 4,
    name: ["root", "G", "P", "tP", "C", "c1", "c2", "tG"],
    parent: [-1, 0, 1, 2, 2, 4, 4, 1],
    div: [0, 0, 0, 0, 0, 0, 0, 0],
    numDate,
    numDateLower: numDate,
    numDateUpper: numDate,
    tipNode: [3, 5, 6, 7],
  });
}

describe("drawTree, radial layout, arcs that span the same angles", () => {
  // Cả cây trong canvas 401 × 401 pixel, bán kính 200 pixel: một năm là 10 pixel.
  const radii = (tree: Tree) =>
    strokesOf(draw(scene(tree, "radial", 400)).recorder).arcs.map((arc) => Math.round(arc.radius * 10) / 10);

  it("keeps them all when they are more than a pixel apart", () => {
    expect(radii(ladderTree([2010.02, 2010.17, 2010.35]))).toEqual([100.2, 101.7, 103.5]);
  });

  it("drops the one that falls on a ring of pixels the others already cover", () => {
    // Ba cung cùng nằm trong vòng pixel thứ 100: cung của C không thêm được pixel nào.
    expect(radii(ladderTree([2010.02, 2010.05, 2010.08]))).toEqual([100.2, 100.5]);
  });
});

describe("drawTree, radial layout, level of detail on a tree much larger than the canvas", () => {
  const tree = parseTree(randomTree(3000, 21));
  const size = 150;
  const everything = () => true;

  it("skips the branches that add no pixel, and still covers what the whole tree covers", () => {
    // Cả cây nằm trong canvas 151 × 151 pixel: vòng ngoài cùng dài 471 pixel cho 3.000 tip.
    const whole = scene(tree, "radial", size);
    const { recorder, stats } = draw(whole);
    const strokes = strokesOf(recorder);
    const all = branchesOf(whole, everything);
    const result = compare(whole, strokes, everything);

    // Vòng tròn dài hơn nhiều so với một cạnh của canvas nên nhánh ít chồng lên nhau hơn ở bố cục chữ nhật:
    // ở đây bỏ được khoảng 4 trong 10 thân nhánh (3.403 còn lại trong 5.861), và vài cung trong 777 cung.
    expect(strokes.lines.length).toBeLessThan((all.stems.length * 2) / 3);
    expect(strokes.arcs.length).toBeLessThan(all.bends.length);
    expect(stats.branchesDrawn).toBe(strokes.lines.length + strokes.arcs.length);
    expect(result.wanted).toBeGreaterThan(5000);
    expect(result.missing).toBe(0);
    expect(result.extra).toBe(0);
    // 96 trong 6.849 pixel (1,4%) lệch sang pixel bên cạnh. Tia rộng gấp đôi thì con số này là 5,4%.
    expect(result.shifted).toBeLessThan(result.wanted * 0.03);
  });

  /**
   * Vẽ cây với tâm ở (centerX, centerY) và bán kính `radius` pixel, rồi kiểm tra những điều phải đúng ở mọi khung
   * nhìn chỉ thấy một phần của cây. Trả về số nét đã vẽ và tổng số nhánh của cây.
   */
  function drawPartly(centerX: number, centerY: number, radius: number): { drawn: number; total: number } {
    const partial = scene(tree, "radial", size, {
      view: { scaleX: 2 * radius, scaleY: 2 * radius, offsetX: centerX - radius, offsetY: centerY - radius },
    });
    const { recorder, stats } = draw(partial);
    const strokes = strokesOf(recorder);
    const all = branchesOf(partial, everything);
    const result = compare(partial, strokes, everything);
    const frame = frameOf(partial);
    const sector = visibleSector(frame.centerX, frame.centerY, partial.width, partial.height);

    // Phần cây lọt vào khung nhìn không nhỏ và được vẽ đủ.
    expect(result.wanted).toBeGreaterThan(1000);
    expect(result.missing).toBe(0);
    expect(result.extra).toBe(0);
    expect(result.shifted).toBeLessThan(result.wanted * 0.03);

    // Không nét nào nằm trọn ngoài phần mặt phẳng mà khung nhìn chạm tới.
    for (const line of strokes.lines) {
      const inner = Math.hypot(line.x0 - frame.centerX, line.y0 - frame.centerY);
      const outer = Math.hypot(line.x1 - frame.centerX, line.y1 - frame.centerY);
      const turn = turnFrom(Math.atan2(line.y1 - frame.centerY, line.x1 - frame.centerX) + 1e-6, sector.from);
      expect(turn).toBeLessThanOrEqual(sector.sweep + 2e-6);
      expect(Math.max(inner, outer)).toBeGreaterThanOrEqual(sector.nearest - 1e-3);
      expect(Math.min(inner, outer)).toBeLessThanOrEqual(sector.farthest + 1e-3);
    }
    for (const arc of strokes.arcs) {
      const turn = turnFrom(arc.from, sector.from);
      expect(arc.radius).toBeGreaterThanOrEqual(sector.nearest - 1);
      expect(arc.radius).toBeLessThanOrEqual(sector.farthest + 1);
      expect(turn <= sector.sweep || turn + (arc.to - arc.from) >= FULL_TURN).toBe(true);
    }

    // Không thân nhánh nào có cả hai đầu cùng nằm ngoài một cạnh của khung nhìn, và không cung nào nằm trọn
    // ngoài một cạnh.
    const stray = strokes.lines.filter((line) => beside([line.x0, line.x1], [line.y0, line.y1], partial));
    const strayArcs = strokes.arcs.filter((arc) => {
      const steps = Math.max(8, Math.ceil((arc.to - arc.from) * arc.radius));
      const at = Array.from({ length: steps + 1 }, (_, n) => arc.from + ((arc.to - arc.from) * n) / steps);
      return beside(
        at.map((angle) => arc.x + arc.radius * Math.cos(angle)),
        at.map((angle) => arc.y + arc.radius * Math.sin(angle)),
        partial,
      );
    });
    expect(stray.length).toBe(0);
    expect(strayArcs.length).toBe(0);
    return { drawn: stats.branchesDrawn, total: all.stems.length + all.bends.length };
  }

  // Phóng 8 lần (bán kính cây 600 pixel) trên canvas 151 × 151 pixel, với tâm cây ở năm chỗ khác nhau: khung
  // nhìn chỉ thấy một mảnh của cây, mỗi lần theo một hướng.
  it.each([
    ["300 pixels left of the viewport", -300, 75],
    ["300 pixels right of the viewport", 451, 75],
    ["300 pixels above the viewport", 75, -300],
    ["300 pixels below the viewport", 75, 451],
    ["inside the viewport, near its left edge", 10, 75],
  ])("draws only what the viewport can show when the centre is %s", (_where, centerX, centerY) => {
    const { drawn, total } = drawPartly(centerX, centerY, 600);

    // 100 tới 280 nét cho 8.983 nhánh của cây.
    expect(drawn).toBeLessThan(total / 20);
  });

  // Cây vừa canvas theo một chiều (bán kính 70 pixel) và bị đẩy lệch 40 pixel, nên tràn ra đúng một cạnh.
  it.each([
    ["left", 30, 75],
    ["right", 121, 75],
    ["top", 75, 30],
    ["bottom", 75, 121],
  ])("leaves out the branches beyond the %s edge when the tree only overflows there", (edge, centerX, centerY) => {
    const { drawn } = drawPartly(centerX, centerY, 70);
    // Cùng tỉ lệ, trong một canvas chứa trọn cây.
    const whole = draw(scene(tree, "radial", 140));

    // Một phần tư diện tích của cây nằm ngoài canvas, nhưng chỉ nhánh nằm trọn bên ngoài mới bị bỏ: còn 3.434
    // tới 3.714 nét tuỳ cạnh, so với 3.991 nét khi cả cây nằm trong canvas.
    expect(drawn, edge).toBeLessThan(whole.stats.branchesDrawn * 0.95);
  });

  it("draws the branches of every colour completely, each in its own colour", () => {
    // Mã màu gán theo từng cụm 40 node liền nhau trong cây (gần giống các clade), gồm cả mã -1 (không có giá trị).
    // Một nửa số tip bị lọc đi, để lượt nhánh mờ cũng có mặt.
    const colors = ["red", "green", "blue", "gold"];
    const nodeCodes = Int32Array.from({ length: tree.nodeCount }, (_, node) => (Math.floor(node / 40) % 5) - 1);
    const tipVisible = Uint8Array.from({ length: tree.tipCount }, (_, tip) => (tip % 600 < 300 ? 1 : 0));
    const coloured = scene(tree, "radial", size, { nodeCodes, colors, tipVisible });
    const { recorder, stats } = draw(coloured);
    const visible = (node: number) => coloured.nodeVisible[node] === 1;

    let total = 0;
    for (let code = -1; code < colors.length; code++) {
      const style = code < 0 ? "branch" : colors[code];
      const strokes = strokesOf(recorder, style);
      const result = compare(coloured, strokes, visible, (node) => nodeCodes[node] === code);
      total += strokes.lines.length + strokes.arcs.length;
      expect(result.wanted, style).toBeGreaterThan(400);
      expect(result.missing, style).toBe(0);
      expect(result.extra, style).toBe(0);
    }
    const muted = strokesOf(recorder, "muted");
    expect(compare(coloured, muted, (node) => !visible(node)).missing).toBe(0);
    expect(stats.branchesDrawn).toBe(total + muted.lines.length + muted.arcs.length);
    // Nhánh mờ được vẽ trước, rồi tới từng màu theo thứ tự mã.
    const order = [...new Set(recorder.lines.map((line) => line.style))];
    expect(order).toEqual(["muted", "branch", "red", "green", "blue", "gold"]);
  });

  it("keeps the branches of the visible tips apart from the muted ones", () => {
    // Chỉ một tip qua bộ lọc: đường từ gốc tới tip đó phải được vẽ đủ, dù các nhánh mờ đã phủ kín quanh nó.
    const tipVisible = new Uint8Array(tree.tipCount);
    tipVisible[1234] = 1;
    const filtered = scene(tree, "radial", size, { tipVisible });
    const { recorder } = draw(filtered);
    const strong = compare(filtered, strokesOf(recorder, "branch"), (node) => filtered.nodeVisible[node] === 1);
    const muted = compare(filtered, strokesOf(recorder, "muted"), (node) => filtered.nodeVisible[node] === 0);

    expect(strong.wanted).toBeGreaterThan(50);
    expect(strong.missing).toBe(0);
    expect(strong.extra).toBe(0);
    expect(muted.wanted).toBeGreaterThan(5000);
    expect(muted.missing).toBe(0);
    expect(muted.extra).toBe(0);
  });
});
