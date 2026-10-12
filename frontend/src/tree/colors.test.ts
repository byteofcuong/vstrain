import { describe, expect, it } from "vitest";

import { colorize, OTHER_COLOR, PALETTE } from "./colors";
import { parseColumn } from "./columns";
import { decimalYear, isoDate, niceTicks } from "./dates";
import { randomTree, smallTree } from "./fixtures";
import { parseTree } from "./parse";

const tree = parseTree(smallTree());

describe("colorize", () => {
  it("gives each value its own colour, in the order of the column, when there are few values", () => {
    const column = parseColumn({ key: "country", scope: "tip", values: ["A", "B"], codes: [1, 1, 1, 0, -1] }, tree);

    const coloring = colorize(column);

    // B có nhiều tip hơn nhưng A vẫn đứng trước: ít giá trị thì giữ thứ tự của cột.
    expect(coloring.order).toEqual([0, 1]);
    expect(coloring.colors).toEqual([PALETTE[0], PALETTE[1]]);
    expect(Array.from(coloring.tipSlots)).toEqual([1, 1, 1, 0, -1]);
    expect(coloring.nodeSlots).toBeNull();
  });

  it("colours the branches too for a column that has a value at every node", () => {
    const column = parseColumn(
      { key: "clade", scope: "node", values: ["I", "II"], codes: [-1, 0, 0, 0, 1, 1, 1, 1] },
      tree,
    );

    expect(Array.from(colorize(column).nodeSlots!)).toEqual([-1, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("keeps the eight most common values and folds the rest into one grey, never a ninth hue", () => {
    // 12 giá trị; giá trị v xuất hiện (v + 1) lần trong mỗi chu kỳ 78 tip, nên giá trị 11 nhiều nhất.
    const big = parseTree(randomTree(156, 5));
    const cycle = Array.from({ length: 12 }, (_, value) => Array<number>(value + 1).fill(value)).flat();
    const codes = Array.from({ length: 156 }, (_, tip) => cycle[tip % cycle.length]);
    const column = parseColumn(
      { key: "country", scope: "tip", values: Array.from({ length: 12 }, (_, v) => `c${v}`), codes },
      big,
    );

    const coloring = colorize(column);

    expect(coloring.distinct).toBe(8);
    expect(coloring.colors).toEqual([...PALETTE, OTHER_COLOR]);
    expect(coloring.order.slice(0, 8)).toEqual([11, 10, 9, 8, 7, 6, 5, 4]);
    expect(Array.from(coloring.slotOfValue.slice(0, 4))).toEqual([8, 8, 8, 8]);
    expect(coloring.slotOfValue[11]).toBe(0);
  });

  it("breaks ties by the order of the column, so the assignment is the same on every load", () => {
    const column = parseColumn(
      { key: "x", scope: "tip", values: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], codes: [9, 9, 3, -1, -1] },
      tree,
    );

    // "j" có 2 tip, "d" có 1 tip, các giá trị còn lại 0 tip và xếp theo thứ tự của cột.
    expect(colorize(column).order).toEqual([9, 3, 0, 1, 2, 4, 5, 6, 7, 8]);
  });
});

describe("dates", () => {
  it("converts calendar dates to decimal years and back", () => {
    expect(decimalYear("2019-01-01")).toBe(2019);
    expect(decimalYear("2019-07-02")).toBeCloseTo(2019.4986, 4);
    expect(isoDate(2019)).toBe("2019-01-01");
    expect(isoDate(2019.4986)).toBe("2019-07-02");
    expect(isoDate(decimalYear("2020-02-29")!)).toBe("2020-02-29");
    expect(isoDate(decimalYear("2018-12-31")!)).toBe("2018-12-31");
  });

  it("survives the four-decimal rounding of the published files", () => {
    for (const date of ["2014-03-07", "2016-12-31", "2020-01-01", "2024-02-29", "1999-10-10"]) {
      const rounded = Math.round(decimalYear(date)! * 10000) / 10000;
      expect(isoDate(rounded)).toBe(date);
    }
  });

  it("rejects text that is not a real calendar date", () => {
    for (const text of ["", "2019", "2019-13-01", "2019-02-30", "19-01-01", "2019-1-1", "abcd-ef-gh"]) {
      expect(decimalYear(text)).toBeNull();
    }
  });

  it("picks round tick values that cover the range", () => {
    expect(niceTicks(1840.2, 2024.6, 8)).toEqual([1850, 1900, 1950, 2000]);
    expect(niceTicks(2010.3, 2019.8, 10)).toEqual([2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]);
    expect(niceTicks(0, 0.11, 5)).toEqual([0, 0.05, 0.1]);
    expect(niceTicks(5, 5, 5)).toEqual([]);
  });
});
