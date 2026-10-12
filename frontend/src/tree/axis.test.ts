import { describe, expect, it } from "vitest";

import { computeGuides } from "./axis";
import { smallTree } from "./fixtures";
import { computePositions } from "./layout";
import { parseTree } from "./parse";
import { fitView, zoomAt } from "./view";

const tree = parseTree(smallTree());
const PADDING = { top: 10, right: 20, bottom: 30, left: 40 };

describe("computeGuides", () => {
  it("puts year marks at the pixel where that year falls", () => {
    // Cây từ năm 2000 tới 2020, vẽ từ pixel 40 tới pixel 1020: mỗi năm 49 pixel.
    const positions = computePositions(tree, "rect", "time");
    const view = fitView(1040, 540, PADDING, "rect");

    const guides = computeGuides(positions, view, 1040, PADDING);

    expect(guides.kind).toBe("lines");
    expect(guides.labels).toEqual([
      "2000",
      "2002",
      "2004",
      "2006",
      "2008",
      "2010",
      "2012",
      "2014",
      "2016",
      "2018",
      "2020",
    ]);
    if (guides.kind === "lines") {
      expect(guides.positions[0]).toBeCloseTo(40);
      expect(guides.positions[5]).toBeCloseTo(40 + 10 * 49);
      expect(guides.positions[10]).toBeCloseTo(1020);
    }
  });

  it("only marks the part of the axis that is in view, with full dates when zoomed below a year", () => {
    const positions = computePositions(tree, "rect", "time");
    const fit = fitView(1040, 540, PADDING, "rect");
    const view = zoomAt(fit, 530, 270, 40, 1); // phóng 40 lần quanh giữa trục: khoảng nửa năm quanh 2010

    const guides = computeGuides(positions, view, 1040, PADDING);

    expect(guides.labels.length).toBeGreaterThan(1);
    for (const label of guides.labels) expect(label).toMatch(/^(2009|2010)-\d{2}-\d{2}$/);
    if (guides.kind === "lines") {
      for (const position of guides.positions) {
        expect(position).toBeGreaterThanOrEqual(40);
        expect(position).toBeLessThanOrEqual(1020);
      }
    }
  });

  it("labels the divergence axis with short numbers", () => {
    const positions = computePositions(tree, "rect", "div");
    const view = fitView(1040, 540, PADDING, "rect");

    expect(computeGuides(positions, view, 1040, PADDING).labels).toEqual([
      "0",
      "0.005",
      "0.01",
      "0.015",
      "0.02",
      "0.025",
      "0.03",
      "0.035",
      "0.04",
    ]);
  });

  it("draws rings at the radius of each mark in the radial layout", () => {
    const positions = computePositions(tree, "radial", "time");
    const view = fitView(1040, 540, PADDING, "radial"); // đường kính 500 pixel, bán kính 250

    const guides = computeGuides(positions, view, 1040, PADDING);

    expect(guides).toEqual({
      kind: "rings",
      radii: [0, 62.5, 125, 187.5, 250],
      labels: ["2000", "2005", "2010", "2015", "2020"],
    });
  });
});
