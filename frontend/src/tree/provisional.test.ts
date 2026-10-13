import { describe, expect, it } from "vitest";

import { NO_FILTERS } from "./filter";
import { smallTree } from "./fixtures";
import { computePositions } from "./layout";
import { parseTree } from "./parse";
import {
  MARKER,
  attachProvisional,
  drawProvisional,
  placeProvisional,
  provisionalAt,
  provisionalExtent,
  provisionalMask,
  type MarkerSurface,
  type ProvisionalLayer,
  type ProvisionalTip,
} from "./provisional";

// Cây nhỏ: 0 gốc; 1 A (con: 2 a1, 3 a2); 4 B (con: 5 b1, 6 b2, 7 b3). Năm tip, mỗi tip một hàng cách nhau 0,25.
const tree = parseTree(smallTree());

function tip(changes: Partial<ProvisionalTip> = {}): ProvisionalTip {
  return {
    internalId: "S0000900",
    displayName: "Hà_Nội/01/2021",
    collectionDate: "2021-XX-XX",
    dateMin: "2021-01-01",
    dateMax: "2021-12-31",
    unitCode: "vn63:ha-noi",
    host: "Homo sapiens",
    parentIndex: 1,
    branchIndex: 3,
    attachDiv: 0.025,
    div: 0.03,
    privateMutations: 4,
    clade: "DENV1/I",
    ...changes,
  };
}

/** Tip treo thẳng vào node B. */
const onB = (changes: Partial<ProvisionalTip> = {}) =>
  tip({ parentIndex: 4, branchIndex: null, attachDiv: 0.005, ...changes });

describe("attachProvisional", () => {
  it("anchors a tip that splits a branch at the node below the split, part of the way along the branch", () => {
    const attached = attachProvisional(tree, [tip()]);

    expect(Array.from(attached.anchor)).toEqual([3]);
    // Cành từ A (0,01) tới a2 (0,04); điểm tách ở 0,025 là đúng giữa cành.
    expect(attached.fraction[0]).toBeCloseTo(0.5);
    expect(attached.div[0]).toBeCloseTo(0.03);
    // Chỉ biết năm 2021: tip đứng ở giữa năm.
    expect(attached.date[0]).toBeGreaterThan(2021.49);
    expect(attached.date[0]).toBeLessThan(2021.51);
  });

  it("anchors a tip hung straight on a node at that node", () => {
    const attached = attachProvisional(tree, [onB()]);

    expect(Array.from(attached.anchor)).toEqual([4]);
    expect(attached.fraction[0]).toBe(1);
  });

  it("keeps the split inside the branch whatever the numbers say", () => {
    const attached = attachProvisional(tree, [
      tip({ attachDiv: 0.5 }),
      tip({ attachDiv: -1 }),
      tip({ parentIndex: 4, branchIndex: 7, attachDiv: Number.NaN }),
    ]);

    expect(Array.from(attached.fraction)).toEqual([1, 0, 1]);
  });

  it("has no date for a tip that did not declare one", () => {
    expect(attachProvisional(tree, [tip({ dateMin: null, dateMax: null })]).date[0]).toBeNaN();
  });

  it("drops a tip that points at a node this tree does not have, instead of drawing it in the wrong place", () => {
    const attached = attachProvisional(tree, [
      tip({ internalId: "kept" }),
      tip({ parentIndex: 99 }),
      tip({ parentIndex: -1 }),
      tip({ parentIndex: 1.5 }),
      // Treo thẳng vào một node không có: không có chỉ số thứ hai nào để lộ ra chỗ sai.
      tip({ parentIndex: 99, branchIndex: null }),
      tip({ parentIndex: -1, branchIndex: null }),
      tip({ parentIndex: 1.5, branchIndex: null }),
      tip({ branchIndex: 99 }),
      // b1 là con của B, không phải của A: hai chỉ số không thuộc cùng một cành.
      tip({ parentIndex: 1, branchIndex: 5 }),
    ]);

    expect(attached.tips.map((one) => one.internalId)).toEqual(["kept"]);
    expect(attached.anchor.length).toBe(1);
  });
});

describe("provisionalExtent", () => {
  const attached = attachProvisional(tree, [
    tip({ dateMin: "2022-06-01", dateMax: "2022-06-01", div: 0.05 }),
    tip({ dateMin: null, dateMax: null, div: 0.02 }),
    tip({ dateMin: "2019-01-01", dateMax: "2019-01-01", div: 0.06 }),
  ]);

  it("spans the values the tips have on the axis, ignoring the ones without a value", () => {
    const [first, last] = provisionalExtent(attached, "time")!;
    expect(first).toBeCloseTo(2019, 2);
    expect(last).toBeGreaterThan(2022.4);
    expect(last).toBeLessThan(2022.43);
    const [low, high] = provisionalExtent(attached, "div")!;
    expect([low, high].map((value) => Number(value.toFixed(3)))).toEqual([0.02, 0.06]);
  });

  it("is nothing when there are no tips or none has a value", () => {
    expect(provisionalExtent(null, "time")).toBeNull();
    expect(provisionalExtent(attachProvisional(tree, []), "div")).toBeNull();
    expect(provisionalExtent(attachProvisional(tree, [tip({ dateMin: null, dateMax: null })]), "time")).toBeNull();
  });
});

describe("computePositions with room for provisional tips", () => {
  it("stretches the axis to hold a value beyond the tree, and never shrinks it", () => {
    const wider = computePositions(tree, "rect", "time", [2021.5, 2022]);
    const same = computePositions(tree, "rect", "time", [2005, 2010]);

    expect([wider.min, wider.max]).toEqual([2000, 2022]);
    expect(wider.x[3]).toBeCloseTo(20 / 22); // a2, năm 2020, không còn nằm ở mép phải
    expect([same.min, same.max]).toEqual([2000, 2020]);
  });
});

describe("placeProvisional", () => {
  it("puts a tip at its own date, half a row below the node it hangs beside, and remembers where it left the branch", () => {
    const attached = attachProvisional(tree, [tip({ dateMin: "2022-01-01", dateMax: "2022-01-01" })]);
    const positions = computePositions(tree, "rect", "time", provisionalExtent(attached, "time"));

    const placed = placeProvisional(tree, positions, attached);

    expect(placed.x[0]).toBeCloseTo(1); // năm 2022 là mép phải của trục đã nới
    expect(placed.y[0]).toBeCloseTo(positions.y[3] + 0.125);
    // Điểm tách: giữa cành từ A (2010) tới a2 (2020), trên hàng của a2.
    expect(placed.fromX[0]).toBeCloseTo((2015 - 2000) / 22);
    expect(placed.fromY[0]).toBeCloseTo(positions.y[3]);
  });

  it("uses divergence on the divergence axis, where the split is exactly where the placement said", () => {
    const attached = attachProvisional(tree, [tip({ attachDiv: 0.025, div: 0.05 })]);
    const positions = computePositions(tree, "rect", "div", provisionalExtent(attached, "div"));

    const placed = placeProvisional(tree, positions, attached);

    expect(positions.max).toBeCloseTo(0.05);
    expect(placed.x[0]).toBeCloseTo(1);
    expect(placed.fromX[0]).toBeCloseTo(0.025 / 0.05);
  });

  it("spreads tips that hang beside the same node over the gap to the next row", () => {
    const attached = attachProvisional(tree, [onB(), tip(), onB()]);
    const positions = computePositions(tree, "rect", "div");

    const placed = placeProvisional(tree, positions, attached);

    const row = 0.25;
    expect(placed.y[0]).toBeCloseTo(positions.y[4] + row / 3);
    expect(placed.y[2]).toBeCloseTo(positions.y[4] + (2 * row) / 3);
    expect(placed.y[1]).toBeCloseTo(positions.y[3] + row / 2);
    // Treo thẳng vào B: điểm tách là chính node B.
    expect([placed.fromX[0], placed.fromY[0]]).toEqual([positions.x[4], positions.y[4]]);
  });

  it("leaves a tip without a date where it split from the branch on the time axis", () => {
    const attached = attachProvisional(tree, [tip({ dateMin: null, dateMax: null })]);
    const positions = computePositions(tree, "rect", "time");

    const placed = placeProvisional(tree, positions, attached);

    expect(placed.x[0]).toBe(placed.fromX[0]);
  });

  it("turns a tip a fraction of a step around the circle in the radial layout", () => {
    const attached = attachProvisional(tree, [tip({ attachDiv: 0.025, div: 0.04 })]);
    const positions = computePositions(tree, "radial", "div");

    const placed = placeProvisional(tree, positions, attached);

    const angle = positions.angle![3] + (0.5 * 2 * Math.PI) / 5;
    expect(placed.layout).toBe("radial");
    expect(placed.x[0]).toBeCloseTo(0.5 + 0.5 * Math.cos(angle)); // div 0,04 là mép ngoài của cây
    expect(placed.y[0]).toBeCloseTo(0.5 + 0.5 * Math.sin(angle));
    // Điểm tách nằm trên tia của a2, ở bán kính ứng với 0,025.
    expect(Math.hypot(placed.fromX[0] - 0.5, placed.fromY[0] - 0.5)).toBeCloseTo(0.5 * (0.025 / 0.04));
    expect(Math.atan2(placed.fromY[0] - 0.5, placed.fromX[0] - 0.5)).toBeCloseTo(positions.angle![3]);
  });
});

describe("provisionalMask", () => {
  const attached = attachProvisional(tree, [
    tip({ dateMin: "2021-03-10", dateMax: "2021-03-10" }),
    tip({ dateMin: "2023-07-01", dateMax: "2023-07-01" }),
    tip({ dateMin: null, dateMax: null }),
  ]);

  it("shows every tip when nothing is filtered", () => {
    expect(Array.from(provisionalMask(attached, NO_FILTERS))).toEqual([1, 1, 1]);
  });

  it("applies the date filter to the date each tip declared, both ends included", () => {
    const dates = (dateFrom: string | null, dateTo: string | null) =>
      Array.from(provisionalMask(attached, { ...NO_FILTERS, dateFrom, dateTo }));

    expect(dates("2021-03-10", "2021-03-10")).toEqual([1, 0, 0]);
    expect(dates("2021-03-11", null)).toEqual([0, 1, 0]);
    expect(dates(null, "2021-03-09")).toEqual([0, 0, 0]);
    expect(dates("2020-01-01", "2023-07-01")).toEqual([1, 1, 0]);
  });

  it("hides every tip while a filter is on that reads columns the tips are not part of", () => {
    expect(Array.from(provisionalMask(attached, { ...NO_FILTERS, values: { host: [0] } }))).toEqual([0, 0, 0]);
    expect(
      Array.from(provisionalMask(attached, { ...NO_FILTERS, area: { level: "macro", codes: ["vnm:north"] } })),
    ).toEqual([0, 0, 0]);
  });
});

/** Một mặt vẽ ghi lại các lệnh, để kiểm tra thứ được vẽ mà không cần canvas. */
function recorder() {
  const calls: (string | number | number[])[][] = [];
  const surface = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    beginPath: () => calls.push(["beginPath"]),
    closePath: () => calls.push(["closePath"]),
    moveTo: (x: number, y: number) => calls.push(["moveTo", x, y]),
    lineTo: (x: number, y: number) => calls.push(["lineTo", x, y]),
    stroke: () => calls.push(["stroke", surface.lineWidth]),
    fill: () => calls.push(["fill"]),
    setLineDash: (pattern: number[]) => calls.push(["setLineDash", pattern]),
  };
  const count = (name: string) => calls.filter((call) => call[0] === name).length;
  return { surface: surface as unknown as MarkerSurface, calls, count };
}

const VIEW = { offsetX: 10, offsetY: 20, scaleX: 400, scaleY: 200 };
const COLORS = { ink: "#17242b", background: "#fcfcfb" };

function layerOf(tips: ProvisionalTip[], layout: "rect" | "radial" = "rect"): ProvisionalLayer {
  const attached = attachProvisional(tree, tips);
  const positions = placeProvisional(tree, computePositions(tree, layout, "div"), attached);
  return { positions, visible: new Uint8Array(tips.length).fill(1), hover: -1, selected: -1 };
}

describe("drawProvisional", () => {
  it("draws a dashed connector and a hollow diamond for each tip that is shown", () => {
    const layer = layerOf([tip(), onB(), onB()]);
    layer.visible[1] = 0;
    const { surface, calls, count } = recorder();

    expect(drawProvisional(surface, VIEW, layer, COLORS, 1000)).toBe(2);

    expect(calls.filter((call) => call[0] === "setLineDash").map((call) => call[1])).toEqual([[3, 3], []]);
    // Một path cho mọi nét nối, rồi mỗi tip một hình thoi được tô nền và viền.
    expect([count("fill"), count("closePath"), count("stroke")]).toEqual([2, 2, 3]);
    // Bố cục chữ nhật: nét nối đi dọc rồi đi ngang, tức hai đoạn cho mỗi tip; hình thoi thêm ba đoạn.
    expect(count("lineTo")).toBe(2 * 2 + 2 * 3);
    const px = VIEW.offsetX + layer.positions.x[0] * VIEW.scaleX;
    const py = VIEW.offsetY + layer.positions.y[0] * VIEW.scaleY;
    expect(calls).toContainEqual(["moveTo", px, py - MARKER]);
  });

  it("joins a tip to its branch with one straight line in the radial layout", () => {
    const { surface, count } = recorder();

    drawProvisional(surface, VIEW, layerOf([tip()], "radial"), COLORS, 1000);

    expect(count("lineTo")).toBe(1 + 3);
  });

  it("outlines the selected tip and the hovered one", () => {
    const layer = { ...layerOf([tip(), onB()]), selected: 0, hover: 1 };
    const { surface, calls } = recorder();

    drawProvisional(surface, VIEW, layer, COLORS, 1000);

    expect(calls.filter((call) => call[0] === "stroke").map((call) => call[1])).toEqual([1.25, 1.75, 1.75, 2.5, 1.5]);
  });

  it("draws nothing for tips that are hidden or under the axis band", () => {
    const hidden = layerOf([tip()]);
    hidden.visible[0] = 0;
    const low = layerOf([tip()]);
    const bottom = VIEW.offsetY + low.positions.y[0] * VIEW.scaleY - 1;

    for (const [layer, limit] of [
      [hidden, 1000],
      [low, bottom],
    ] as const) {
      const { surface, calls } = recorder();
      expect(drawProvisional(surface, VIEW, layer, COLORS, limit)).toBe(0);
      expect(calls).toEqual([]);
    }
  });
});

describe("provisionalAt", () => {
  const layer = layerOf([tip(), onB()]);
  const point = (index: number) => ({
    x: VIEW.offsetX + layer.positions.x[index] * VIEW.scaleX,
    y: VIEW.offsetY + layer.positions.y[index] * VIEW.scaleY,
  });

  it("finds the tip under the pointer, allowing for the size of its marker", () => {
    const first = point(0);

    expect(provisionalAt(layer, VIEW, first.x, first.y, 8)).toBe(0);
    expect(provisionalAt(layer, VIEW, first.x + MARKER + 7, first.y, 8)).toBe(0);
    expect(provisionalAt(layer, VIEW, first.x + MARKER + 9, first.y, 8)).toBe(-1);
    expect(provisionalAt(layer, VIEW, point(1).x, point(1).y, 8)).toBe(1);
  });

  it("does not find a tip that is hidden", () => {
    const hidden = { ...layer, visible: Uint8Array.from([0, 1]) };

    expect(provisionalAt(hidden, VIEW, point(0).x, point(0).y, 8)).toBe(-1);
  });
});
