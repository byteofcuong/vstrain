/** Đồ dùng chung cho các test của bộ vẽ: một "canvas" ghi lại lệnh vẽ, và cách dựng một cảnh để vẽ. */
import { createScratch, drawTree, type Scene, type Surface, type Theme } from "./draw";
import { nodeMask } from "./filter";
import { computePositions, type Layout } from "./layout";
import type { Tree } from "./parse";

export const THEME: Theme = {
  branch: "branch",
  branchMuted: "muted",
  missing: "missing",
  highlight: "highlight",
  background: "background",
  guide: "guide",
  guideText: "guide-text",
  font: "12px sans-serif",
};

export interface Line {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  style: string;
}

export interface Arc {
  /** Tâm của cung. */
  x: number;
  y: number;
  radius: number;
  from: number;
  to: number;
  style: string;
  /** Cung được vẽ nét (nhánh) hay được tô (tip). */
  kind: "stroke" | "fill";
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
}

/** Thay cho Canvas: ghi lại các đoạn thẳng, cung và hình chữ nhật được vẽ, kèm màu lúc `stroke` hoặc `fill`. */
export class Recorder implements Surface {
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
  arc(x: number, y: number, radius: number, from: number, to: number): void {
    this.pendingArcs.push({ x, y, radius, from, to });
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

/** Một cảnh trong đó cây phủ đúng hình vuông [0, size] × [0, size], mọi tip đều hiện, không tô màu. */
export function scene(tree: Tree, layout: Layout, size: number, overrides: Partial<Scene> = {}): Scene {
  const tipVisible = overrides.tipVisible ?? new Uint8Array(tree.tipCount).fill(1);
  return {
    tree,
    positions: computePositions(tree, layout, "time"),
    view: { scaleX: size, scaleY: size, offsetX: 0, offsetY: 0 },
    // Canvas rộng hơn một pixel để mép cuối của cây nằm trong.
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

export function draw(sceneToDraw: Scene): { recorder: Recorder; stats: ReturnType<typeof drawTree> } {
  const recorder = new Recorder();
  const stats = drawTree(recorder, sceneToDraw, createScratch());
  return { recorder, stats };
}
