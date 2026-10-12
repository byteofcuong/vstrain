import { describe, expect, it } from "vitest";

import { colorOf, EMPTY_COLOR, SCALE, scaleLabels } from "./scale";

describe("map colour scale", () => {
  it("gives areas without samples the neutral colour of empty land", () => {
    expect(colorOf(0)).toBe(EMPTY_COLOR);
    expect(SCALE.map((step) => step.color)).not.toContain(EMPTY_COLOR);
  });

  it("puts a count in the class whose lower bound it has reached", () => {
    const colors = SCALE.map((step) => step.color);

    expect([1, 9].map(colorOf)).toEqual([colors[0], colors[0]]);
    expect([10, 49].map(colorOf)).toEqual([colors[1], colors[1]]);
    expect([50, 199].map(colorOf)).toEqual([colors[2], colors[2]]);
    expect([200, 999].map(colorOf)).toEqual([colors[3], colors[3]]);
    expect([1000, 250_000].map(colorOf)).toEqual([colors[4], colors[4]]);
  });

  it("has classes that start at 1 and grow, each with its own colour", () => {
    const bounds = SCALE.map((step) => step.from);

    expect(bounds[0]).toBe(1);
    expect([...bounds].sort((a, b) => a - b)).toEqual(bounds);
    expect(new Set(bounds).size).toBe(bounds.length);
    expect(new Set(SCALE.map((step) => step.color)).size).toBe(SCALE.length);
  });

  it("labels each class with its range, in the number format of the language", () => {
    expect(scaleLabels("vi")).toEqual(["1–9", "10–49", "50–199", "200–999", "≥ 1.000"]);
    expect(scaleLabels("en")).toEqual(["1–9", "10–49", "50–199", "200–999", "≥ 1,000"]);
  });
});
