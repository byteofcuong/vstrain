import { describe, expect, it } from "vitest";

import { smallTree } from "./fixtures";
import { computePositions } from "./layout";
import { parseTree } from "./parse";
import { clampView, fitView, pan, toWorldX, toWorldY, zoomAt, zoomWithin } from "./view";

const tree = parseTree(smallTree());
const PADDING = { top: 10, right: 20, bottom: 30, left: 40 };

describe("computePositions", () => {
  it("places nodes by date along x and by row along y in the rectangular layout", () => {
    const positions = computePositions(tree, "rect", "time");

    expect([positions.min, positions.max]).toEqual([2000, 2020]);
    expect(positions.x[0]).toBe(0);
    expect(positions.x[3]).toBe(1); // a2, năm 2020
    expect(positions.x[2]).toBeCloseTo(0.75); // a1, năm 2015
    expect(positions.y[2]).toBe(0); // tip đầu tiên ở trên cùng
    expect(positions.y[7]).toBe(1); // tip cuối cùng ở dưới cùng
    expect(positions.y[1]).toBeCloseTo(0.125); // A nằm giữa a1 và a2
    expect(positions.angle).toBeNull();
  });

  it("puts a node without a date where its parent is", () => {
    const positions = computePositions(tree, "rect", "time");

    expect(positions.x[7]).toBe(positions.x[4]);
  });

  it("uses divergence when asked", () => {
    const positions = computePositions(tree, "rect", "div");

    expect(positions.min).toBe(0);
    expect(positions.max).toBeCloseTo(0.04);
    expect(positions.x[3]).toBe(1);
    expect(positions.x[1]).toBeCloseTo(0.25);
  });

  it("wraps the rows around a circle in the radial layout, with the root at the centre", () => {
    const positions = computePositions(tree, "radial", "time");

    expect([positions.x[0], positions.y[0]]).toEqual([0.5, 0.5]);
    // a2 (hàng 1 trong 5, năm 2020) nằm trên đường tròn ngoài cùng, ở góc 1/5 vòng.
    const theta = (2 * Math.PI) / 5;
    expect(positions.angle![3]).toBeCloseTo(theta);
    expect(positions.x[3]).toBeCloseTo(0.5 + 0.5 * Math.cos(theta));
    expect(positions.y[3]).toBeCloseTo(0.5 + 0.5 * Math.sin(theta));
    for (let i = 0; i < tree.nodeCount; i++) {
      expect(Math.hypot(positions.x[i] - 0.5, positions.y[i] - 0.5)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  it("does not divide by zero for a tree with a single tip", () => {
    const single = parseTree({
      nodeCount: 1,
      tipCount: 1,
      name: ["only"],
      parent: [-1],
      div: [0],
      numDate: [2020],
      numDateLower: [2020],
      numDateUpper: [2020],
      tipNode: [0],
    });

    const positions = computePositions(single, "rect", "time");

    expect([positions.x[0], positions.y[0]]).toEqual([0, 0.5]);
  });
});

describe("view", () => {
  it("fits the whole tree inside the padding", () => {
    const view = fitView(1040, 540, PADDING, "rect");

    expect(view).toEqual({ scaleX: 980, scaleY: 500, offsetX: 40, offsetY: 10 });
  });

  it("keeps the radial layout round and centred", () => {
    const view = fitView(1040, 540, PADDING, "radial");

    expect(view.scaleX).toBe(500);
    expect(view.scaleY).toBe(500);
    expect(view.offsetX).toBe(40 + (980 - 500) / 2);
  });

  it("fits a part of the tree when given a box", () => {
    const view = fitView(1040, 540, PADDING, "rect", { x0: 0.5, y0: 0.25, x1: 1, y1: 0.75 });

    expect(view.offsetX + 0.5 * view.scaleX).toBeCloseTo(40);
    expect(view.offsetX + 1 * view.scaleX).toBeCloseTo(1020);
    expect(view.offsetY + 0.25 * view.scaleY).toBeCloseTo(10);
    expect(view.offsetY + 0.75 * view.scaleY).toBeCloseTo(510);
  });

  it("zooms around the cursor: the point under it does not move", () => {
    const before = fitView(1040, 540, PADDING, "rect");
    const worldX = toWorldX(before, 300);
    const worldY = toWorldY(before, 200);

    const after = zoomAt(before, 300, 200, 2, 3);

    expect(after.scaleX).toBe(before.scaleX * 2);
    expect(after.scaleY).toBe(before.scaleY * 3);
    expect(toWorldX(after, 300)).toBeCloseTo(worldX);
    expect(toWorldY(after, 200)).toBeCloseTo(worldY);
  });

  it("stops at the zoom limit without moving the point under the cursor", () => {
    const fit = fitView(1040, 540, PADDING, "rect");
    const worldY = toWorldY(fit, 200);

    const zoomed = zoomWithin(fit, fit, 300, 200, 1, 1000, 60, 8);

    expect(zoomed.scaleY).toBe(fit.scaleY * 8);
    expect(zoomed.scaleX).toBe(fit.scaleX);
    expect(toWorldY(zoomed, 200)).toBeCloseTo(worldY);
    // Thu nhỏ quá mức vừa khít thì về đúng mức vừa khít.
    expect(zoomWithin(zoomed, fit, 300, 200, 1, 0.001, 60, 8)).toEqual(fit);
  });

  it("does not zoom out past the fitted view, zoom in past the limit, or drag the tree away", () => {
    const fit = fitView(1040, 540, PADDING, "rect");

    expect(clampView(zoomAt(fit, 500, 300, 0.2, 0.2), fit, 50)).toEqual(fit);
    expect(clampView(zoomAt(fit, 500, 300, 1000, 1000), fit, 50).scaleY).toBe(fit.scaleY * 50);
    expect(clampView(pan(fit, 400, -300), fit, 50)).toEqual(fit);

    const zoomed = clampView(pan(zoomAt(fit, 500, 300, 4, 4), 1e6, 1e6), fit, 50);
    expect(zoomed.offsetX).toBe(fit.offsetX); // mép trái của cây dừng ở lề trái
    const farLeft = clampView(pan(zoomAt(fit, 500, 300, 4, 4), -1e6, -1e6), fit, 50);
    expect(farLeft.offsetX + farLeft.scaleX).toBeCloseTo(fit.offsetX + fit.scaleX); // mép phải dừng ở lề phải
  });
});
