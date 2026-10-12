import { describe, expect, it } from "vitest";

import { claimBits, createScratch, drawTree, type Scene, type Surface, type Theme } from "./draw";
import { nodeMask } from "./filter";
import { randomTree, smallTree } from "./fixtures";
import { computePositions, type Layout } from "./layout";
import { parseTree, type Tree } from "./parse";

const THEME: Theme = {
  branch: "branch",
  branchMuted: "muted",
  missing: "missing",
  highlight: "highlight",
  background: "background",
  guide: "guide",
  guideText: "guide-text",
  font: "12px sans-serif",
};

interface Line {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  style: string;
}

interface Arc {
  radius: number;
  from: number;
  to: number;
  style: string;
  /** Cung được vẽ nét (nhánh) hay được tô (tip). */
  kind: "stroke" | "fill";
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
}

/** Thay cho Canvas: ghi lại các đoạn thẳng, cung và hình chữ nhật được vẽ, kèm màu lúc `stroke` hoặc `fill`. */
class Recorder implements Surface {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  font = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  lines: Line[] = [];
  arcs: Arc[] = [];
  rects: Rect[] = [];
  private pendingLines: Omit<Line, "style">[] = [];
  private pendingArcs: Omit<Arc, "style" | "kind">[] = [];
  private at: [number, number] = [0, 0];

  beginPath(): void {
    this.pendingLines = [];
    this.pendingArcs = [];
  }
  moveTo(x: number, y: number): void {
    this.at = [x, y];
  }
  lineTo(x: number, y: number): void {
    this.pendingLines.push({ x0: this.at[0], y0: this.at[1], x1: x, y1: y });
    this.at = [x, y];
  }
  arc(_x: number, _y: number, radius: number, from: number, to: number): void {
    this.pendingArcs.push({ radius, from, to });
  }
  stroke(): void {
    const style = String(this.strokeStyle);
    this.lines.push(...this.pendingLines.map((line) => ({ ...line, style })));
    this.arcs.push(...this.pendingArcs.map((arc) => ({ ...arc, style, kind: "stroke" as const })));
  }
  fill(): void {
    const style = String(this.fillStyle);
    this.arcs.push(...this.pendingArcs.map((arc) => ({ ...arc, style, kind: "fill" as const })));
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.rects.push({ x, y, width, height, style: String(this.fillStyle) });
  }
  fillText(): void {}
}

function scene(tree: Tree, layout: Layout, size: number, overrides: Partial<Scene> = {}): Scene {
  const tipVisible = overrides.tipVisible ?? new Uint8Array(tree.tipCount).fill(1);
  return {
    tree,
    positions: computePositions(tree, layout, "time"),
    // Cây phủ đúng hình vuông [0, size] × [0, size]; canvas rộng hơn một pixel để mép cuối nằm trong.
    view: { scaleX: size, scaleY: size, offsetX: 0, offsetY: 0 },
    width: size + 1,
    height: size + 1,
    tipVisible,
    nodeVisible: nodeMask(tree, tipVisible),
    tipCodes: null,
    nodeCodes: null,
    colors: [],
    theme: THEME,
    hoverTip: -1,
    selectedTip: -1,
    guides: null,
    ...overrides,
  };
}

function draw(sceneToDraw: Scene) {
  const recorder = new Recorder();
  const stats = drawTree(recorder, sceneToDraw, createScratch());
  return { recorder, stats };
}

const close = (value: number) => Math.round(value * 1000) / 1000;
const horizontal = (lines: Line[]) => lines.filter((line) => line.y0 === line.y1);
const vertical = (lines: Line[]) => lines.filter((line) => line.x0 === line.x1 && line.y0 !== line.y1);
const span = (line: Line) => [Math.min(line.x0, line.x1), Math.max(line.x0, line.x1), line.y0].map(close);
const rise = (line: Line) => [line.x0, Math.min(line.y0, line.y1), Math.max(line.y0, line.y1)].map(close);

/** Các pixel mà một tập đoạn đi qua, dạng "hàng:vị trí"; mỗi đoạn là [from, to, hàng], tính cả hai đầu. */
function pixels(segments: [number, number, number][]): Set<string> {
  const covered = new Set<string>();
  for (const [from, to, line] of segments) {
    for (let at = Math.floor(from); at <= Math.floor(to); at++) covered.add(`${Math.floor(line)}:${at}`);
  }
  return covered;
}

describe("drawTree, rectangular layout", () => {
  const tree = parseTree(smallTree());

  it("draws one stem per node and one connector per inner node", () => {
    const { recorder, stats } = draw(scene(tree, "rect", 100));

    // Thân nhánh: từ vị trí của cha tới vị trí của node, ở hàng của node. b3 không có ngày nên không có thân.
    expect(horizontal(recorder.lines).map(span)).toEqual([
      [0, 50, 12.5], // A
      [50, 75, 0], // a1
      [50, 100, 25], // a2
      [0, 25, 75], // B
      [25, 60, 50], // b1
      [25, 90, 75], // b2
    ]);
    // Đoạn nối: ở vị trí của node trong, phủ từ con trên cùng tới con dưới cùng.
    expect(vertical(recorder.lines).map(rise)).toEqual([
      [0, 12.5, 75], // gốc: từ A tới B
      [50, 0, 25], // A: từ a1 tới a2
      [25, 50, 100], // B: từ b1 tới b3
    ]);
    expect(stats.branchesDrawn).toBe(9);
    expect(new Set(recorder.lines.map((line) => line.style))).toEqual(new Set(["branch"]));
  });

  it("mutes the branches that lead to no visible tip and draws them underneath", () => {
    // Chỉ a2 qua bộ lọc: đường từ gốc tới a2 được vẽ đậm, phần còn lại mờ.
    const { recorder } = draw(scene(tree, "rect", 100, { tipVisible: Uint8Array.from([0, 1, 0, 0, 0]) }));
    const of = (style: string) => recorder.lines.filter((line) => line.style === style);

    expect(horizontal(of("branch")).map(span)).toEqual([
      [0, 50, 12.5], // A
      [50, 100, 25], // a2
    ]);
    expect(vertical(of("branch")).map(rise)).toEqual([
      [0, 12.5, 43.75], // gốc: chỉ tới A
      [50, 12.5, 25], // A: chỉ tới a2
    ]);
    expect(horizontal(of("muted")).map(span)).toEqual([
      [50, 75, 0], // a1
      [0, 25, 75], // B
      [25, 60, 50], // b1
      [25, 90, 75], // b2
    ]);
    expect(vertical(of("muted")).map(rise)).toEqual([
      [0, 43.75, 75], // gốc: tới B
      [50, 0, 12.5], // A: tới a1
      [25, 50, 100], // B
    ]);
    // Nhánh mờ được vẽ trước, để nhánh đậm đè lên.
    const firstStrong = recorder.lines.findIndex((line) => line.style === "branch");
    expect(recorder.lines.slice(firstStrong).every((line) => line.style === "branch")).toBe(true);
  });

  it("gives a stem the colour of its node and a connector the colour of the inner node", () => {
    // Gốc không có giá trị; A và các con của nó mang mã 0; B và các con của nó mang mã 1.
    const nodeCodes = Int32Array.from([-1, 0, 0, 0, 1, 1, 1, 1]);
    const { recorder } = draw(scene(tree, "rect", 100, { nodeCodes, colors: ["red", "blue"] }));
    const styleOf = (lines: Line[], key: number[]) =>
      lines.find((line) => JSON.stringify(line.y0 === line.y1 ? span(line) : rise(line)) === JSON.stringify(key))
        ?.style;

    expect(styleOf(recorder.lines, [0, 50, 12.5])).toBe("red"); // thân của A
    expect(styleOf(recorder.lines, [0, 25, 75])).toBe("blue"); // thân của B
    expect(styleOf(recorder.lines, [25, 90, 75])).toBe("blue"); // thân của b2
    expect(styleOf(recorder.lines, [0, 12.5, 75])).toBe("branch"); // đoạn nối của gốc: không có giá trị
    expect(styleOf(recorder.lines, [50, 0, 25])).toBe("red"); // đoạn nối của A
    expect(styleOf(recorder.lines, [25, 50, 100])).toBe("blue"); // đoạn nối của B
    expect(recorder.lines).toHaveLength(9);
  });

  it("draws each tip once, in the colour of its code", () => {
    const tipCodes = Int32Array.from([0, 1, 0, -1, 1]);
    const { recorder, stats } = draw(scene(tree, "rect", 400, { tipCodes, colors: ["red", "blue"] }));

    // Tip cách nhau 100 pixel nên được vẽ thành hình tròn.
    const tips = recorder.arcs.filter((arc) => arc.kind === "fill");
    expect(tips.map((arc) => arc.style).sort()).toEqual(["blue", "blue", "missing", "red", "red"]);
    expect([stats.tipsVisible, stats.tipsDrawn]).toEqual([5, 5]);
  });

  it("skips what lies outside the canvas", () => {
    const zoomed = scene(tree, "rect", 100);
    // Phóng 3 lần vào góc trên bên trái của cây; khung nhìn vẫn là 101 × 101 pixel.
    zoomed.view = { scaleX: 300, scaleY: 300, offsetX: 0, offsetY: 0 };

    const { recorder, stats } = draw(zoomed);

    // Chỉ còn hai đoạn chạm vào khung nhìn: thân của A (bắt đầu trong khung) và đoạn nối của gốc.
    expect(horizontal(recorder.lines).map(span)).toEqual([[0, 150, 37.5]]);
    expect(vertical(recorder.lines).map(rise)).toEqual([[0, 37.5, 225]]);
    expect(stats.tipsDrawn).toBe(0); // tip gần nhất (a1) ở x = 225, ngoài khung
    expect(stats.tipsVisible).toBe(5);
  });
});

describe("claimBits", () => {
  it("reports whether a range covers a pixel that was not covered before", () => {
    const bits = new Uint32Array(4);

    expect(claimBits(bits, 0, 3, 40)).toBe(true);
    expect(claimBits(bits, 0, 3, 40)).toBe(false);
    expect(claimBits(bits, 0, 10, 35)).toBe(false); // nằm trọn trong đoạn đã có
    expect(claimBits(bits, 0, 41, 41)).toBe(true); // thêm đúng một pixel
    expect(claimBits(bits, 0, 0, 41)).toBe(true); // pixel 0, 1, 2 còn trống
    expect(claimBits(bits, 0, 0, 41)).toBe(false);
  });

  it("handles ranges that end exactly at a word boundary", () => {
    for (const [first, last] of [
      [0, 31],
      [31, 32],
      [32, 63],
      [63, 64],
      [0, 0],
      [95, 95],
      [0, 95],
    ]) {
      const bits = new Uint32Array(3);
      expect(claimBits(bits, 0, first, last), `${first}..${last}`).toBe(true);
      // Đúng các bit trong đoạn được bật, không thừa không thiếu.
      for (let at = 0; at < 96; at++) {
        expect((bits[at >> 5] >>> (at & 31)) & 1, `bit ${at} of ${first}..${last}`).toBe(
          at >= first && at <= last ? 1 : 0,
        );
      }
      expect(claimBits(bits, 0, first, last)).toBe(false);
    }
  });

  it("only touches the row it is given", () => {
    const bits = new Uint32Array(6);

    claimBits(bits, 2, 0, 63);

    expect(Array.from(bits)).toEqual([0, 0, 0xffffffff, 0xffffffff, 0, 0]);
  });

  it("agrees with a plain array of flags on random ranges", () => {
    const bits = new Uint32Array(8);
    const flags = new Array<boolean>(256).fill(false);
    let state = 12345;
    const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296;
    for (let n = 0; n < 500; n++) {
      const first = Math.floor(random() * 256);
      const last = Math.min(255, first + Math.floor(random() * 40));
      let fresh = false;
      for (let at = first; at <= last; at++) {
        if (!flags[at]) fresh = true;
        flags[at] = true;
      }
      expect(claimBits(bits, 0, first, last), `range ${first}..${last} at step ${n}`).toBe(fresh);
    }
  });
});

describe("drawTree, level of detail on a tree much larger than the canvas", () => {
  const tree = parseTree(randomTree(3000, 21));
  const size = 150;
  const drawn = draw(scene(tree, "rect", size));
  const positions = computePositions(tree, "rect", "time");

  it("draws far fewer segments than the tree has branches", () => {
    // 5.998 thân nhánh và 2.999 đoạn nối, trên một canvas 151 × 151 pixel.
    expect(drawn.stats.branchesDrawn).toBeLessThan(tree.nodeCount / 2);
    expect(drawn.stats.branchesDrawn).toBe(drawn.recorder.lines.length);
  });

  it("still covers every pixel that the stems of the whole tree cover", () => {
    const all: [number, number, number][] = [];
    for (let i = 1; i < tree.nodeCount; i++) {
      const x0 = positions.x[tree.parent[i]] * size;
      const x1 = positions.x[i] * size;
      if (Math.abs(x1 - x0) >= 0.25) all.push([Math.min(x0, x1), Math.max(x0, x1), positions.y[i] * size]);
    }
    const kept = horizontal(drawn.recorder.lines).map((line): [number, number, number] => [
      Math.min(line.x0, line.x1),
      Math.max(line.x0, line.x1),
      line.y0,
    ]);

    expect(kept.length).toBeLessThan(all.length / 2);
    expect(pixels(kept)).toEqual(pixels(all));
  });

  it("still covers every pixel that the connectors of the whole tree cover", () => {
    const low = new Float64Array(tree.nodeCount).fill(Infinity);
    const high = new Float64Array(tree.nodeCount).fill(-Infinity);
    for (let i = 1; i < tree.nodeCount; i++) {
      const up = tree.parent[i];
      low[up] = Math.min(low[up], positions.y[i]);
      high[up] = Math.max(high[up], positions.y[i]);
    }
    const all: [number, number, number][] = [];
    for (let p = 0; p < tree.nodeCount; p++) {
      if (!(low[p] <= high[p])) continue;
      const from = Math.min(low[p], positions.y[p]) * size;
      const to = Math.max(high[p], positions.y[p]) * size;
      if (to - from >= 0.25) all.push([from, to, positions.x[p] * size]);
    }
    const kept = vertical(drawn.recorder.lines).map((line): [number, number, number] => [
      Math.min(line.y0, line.y1),
      Math.max(line.y0, line.y1),
      line.x0,
    ]);

    expect(pixels(kept)).toEqual(pixels(all));
  });

  it("marks exactly the 2 by 2 pixel cells that hold a tip, in the colour of the first tip of each cell", () => {
    // Màu xen kẽ theo từng cụm 7 tip liền nhau trong cây, để các ô kề nhau có lúc cùng màu, có lúc khác màu.
    const tipCodes = Int32Array.from({ length: tree.tipCount }, (_, tip) => Math.floor(tip / 7) % 3);
    const coloured = draw(scene(tree, "rect", size, { tipCodes, colors: ["red", "green", "blue"] }));
    const expected = new Map<string, string>();
    for (let tip = 0; tip < tree.tipCount; tip++) {
      const node = tree.tipNode[tip];
      const cell = `${Math.floor((positions.y[node] * size) / 2)}:${Math.floor((positions.x[node] * size) / 2)}`;
      if (!expected.has(cell)) expected.set(cell, ["red", "green", "blue"][tipCodes[tip]]);
    }

    const actual = new Map<string, string>();
    const tips = coloured.recorder.rects.filter((rect) => rect.style !== "background");
    for (const rect of tips) {
      expect(rect.height).toBe(2);
      for (let column = rect.x / 2; column < (rect.x + rect.width) / 2; column++) {
        const cell = `${rect.y / 2}:${column}`;
        expect(actual.has(cell), `cell ${cell} is drawn once`).toBe(false);
        actual.set(cell, rect.style);
      }
    }

    expect(actual).toEqual(expected);
    expect(coloured.stats.tipsDrawn).toBe(expected.size);
    expect(coloured.stats.tipsVisible).toBe(3000);
    // Các ô kề nhau cùng màu được gộp, nên số hình chữ nhật ít hơn số ô.
    expect(tips.length).toBeLessThan(expected.size);
  });
});

describe("drawTree, radial layout", () => {
  const tree = parseTree(smallTree());

  it("draws a radial stem per node and one arc per inner node, spanning its children", () => {
    const { recorder, stats } = draw(scene(tree, "radial", 100));
    const turn = (2 * Math.PI) / 5;

    // Gốc ở tâm nên không có cung. A ở bán kính 25, từ a1 (góc 0) tới a2; B ở bán kính 12,5, từ b1 tới b3.
    const arcs = recorder.arcs.filter((arc) => arc.kind === "stroke");
    expect(arcs.map((arc) => [arc.radius, arc.from, arc.to].map(close))).toEqual([
      [25, 0, close(turn)],
      [12.5, close(2 * turn), close(4 * turn)],
    ]);
    // Thân của a2: từ vòng tròn của A (bán kính 25) ra tới bán kính 50, cùng một góc.
    const a2 = recorder.lines.find((line) => close(Math.hypot(line.x1 - 50, line.y1 - 50)) === 50);
    expect(a2).toBeDefined();
    expect(close(Math.hypot(a2!.x0 - 50, a2!.y0 - 50))).toBe(25);
    expect(close(Math.atan2(a2!.y0 - 50, a2!.x0 - 50))).toBe(close(Math.atan2(a2!.y1 - 50, a2!.x1 - 50)));
    // 6 thân (b3 trùng vị trí với B nên không có) và 2 cung.
    expect(recorder.lines).toHaveLength(6);
    expect(stats.branchesDrawn).toBe(8);
  });
});
