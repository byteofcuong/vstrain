import { describe, expect, it } from "vitest";

import { ColumnFormatError, parseColumn, type Column } from "./columns";
import { dayRange } from "./dates";
import { countSet, hasFilters, MISSING, NO_FILTERS, nodeMask, tipMask, visibleCounts } from "./filter";
import { randomTree, smallTree } from "./fixtures";
import { buildTipGrid, nearestTip } from "./grid";
import { computePositions } from "./layout";
import { parseTree } from "./parse";

const tree = parseTree(smallTree());

// Tip theo thứ tự: a1, a2, b1, b2, b3.
const country = parseColumn(
  { key: "country", scope: "tip", values: ["Vietnam", "Thailand"], codes: [0, 0, 1, -1, 0] },
  tree,
);
const clade = parseColumn({ key: "clade", scope: "node", values: ["I", "II"], codes: [-1, 0, 0, 0, 1, 1, 1, 1] }, tree);
const columns = new Map<string, Column>([
  ["country", country],
  ["clade", clade],
]);

describe("parseColumn", () => {
  it("counts the tips of each value and the tips without one", () => {
    expect(Array.from(country.counts)).toEqual([3, 1]);
    expect(country.missing).toBe(1);
    expect(country.labels).toEqual(["Vietnam", "Thailand"]);
    expect(country.nodeCodes).toBeNull();
  });

  it("reads the tip codes of a node column from the nodes that are tips", () => {
    expect(Array.from(clade.tipCodes)).toEqual([0, 0, 1, 1, 1]);
    expect(clade.nodeCodes).not.toBeNull();
  });

  it("uses the labels of the file when it has them", () => {
    const unit = parseColumn(
      { key: "unit", scope: "tip", values: ["vn63:ha-noi"], labels: ["Hà Nội"], codes: [0, -1, -1, -1, -1] },
      tree,
    );

    expect(unit.labels).toEqual(["Hà Nội"]);
  });

  it("rejects a column of the wrong length or with a code outside its values", () => {
    expect(() => parseColumn({ key: "x", scope: "tip", values: ["a"], codes: [0, 0] }, tree)).toThrow(
      ColumnFormatError,
    );
    expect(() => parseColumn({ key: "x", scope: "tip", values: ["a"], codes: [0, 0, 1, 0, 0] }, tree)).toThrow(
      ColumnFormatError,
    );
  });
});

describe("tipMask", () => {
  it("keeps every tip when there are no filters", () => {
    expect(Array.from(tipMask(tree, columns, NO_FILTERS))).toEqual([1, 1, 1, 1, 1]);
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it("filters by a range of days, both days included, and drops tips without a date", () => {
    // a1 2015, a2 2020, b1 2012, b2 2018 (đều là đầu ngày 1 tháng 1), b3 không có ngày.
    const whole = tipMask(tree, columns, { dateFrom: "2012-01-01", dateTo: "2018-01-01", values: {} });
    const inside = tipMask(tree, columns, { dateFrom: "2012-01-02", dateTo: "2017-12-31", values: {} });

    expect(Array.from(whole)).toEqual([1, 0, 1, 1, 0]);
    expect(Array.from(inside)).toEqual([1, 0, 0, 0, 0]);
  });

  it("takes the first moment of the range and leaves out the first moment after it", () => {
    const [from, before] = dayRange("2015-03-01", "2015-03-31");
    const file = smallTree();
    // Tip a1 nằm đúng ở thời điểm đầu của khoảng, a2 đúng ở thời điểm đầu tiên sau khoảng.
    file.numDate[2] = from;
    file.numDate[3] = before;

    const mask = tipMask(parseTree(file), columns, { dateFrom: "2015-03-01", dateTo: "2015-03-31", values: {} });

    expect(Array.from(mask)).toEqual([1, 0, 0, 0, 0]);
  });

  it("accepts a range that is open on one side", () => {
    const from2016 = { dateFrom: "2016-01-01", dateTo: null, values: {} };
    const until2015 = { dateFrom: null, dateTo: "2015-01-01", values: {} };

    expect(Array.from(tipMask(tree, columns, from2016))).toEqual([0, 1, 0, 1, 0]);
    expect(Array.from(tipMask(tree, columns, until2015))).toEqual([1, 0, 1, 0, 0]);
    expect(hasFilters(from2016)).toBe(true);
    expect(hasFilters(until2015)).toBe(true);
  });

  it("keeps the tips whose value is one of the selected values", () => {
    const mask = tipMask(tree, columns, { dateFrom: null, dateTo: null, values: { country: [1] } });

    expect(Array.from(mask)).toEqual([0, 0, 1, 0, 0]);
  });

  it("can select the tips that have no value", () => {
    const mask = tipMask(tree, columns, { dateFrom: null, dateTo: null, values: { country: [MISSING, 1] } });

    expect(Array.from(mask)).toEqual([0, 0, 1, 1, 0]);
  });

  it("combines the date range and several columns with AND", () => {
    const filters = { dateFrom: "2000-01-01", dateTo: "2016-01-01", values: { country: [0], clade: [0] } };

    expect(Array.from(tipMask(tree, columns, filters))).toEqual([1, 0, 0, 0, 0]);
    expect(hasFilters(filters)).toBe(true);
  });

  it("ignores an empty selection, an unknown column and codes outside the column", () => {
    const filters = { dateFrom: null, dateTo: null, values: { country: [], nothing: [3], clade: [0, 7, -5] } };

    expect(Array.from(tipMask(tree, columns, filters))).toEqual([1, 1, 0, 0, 0]);
  });
});

describe("nodeMask", () => {
  it("marks every ancestor of a visible tip and nothing else", () => {
    const mask = nodeMask(tree, Uint8Array.from([0, 1, 0, 0, 0]));

    // Chỉ a2 hiện: gốc, A và a2 được đánh dấu.
    expect(Array.from(mask)).toEqual([1, 1, 0, 1, 0, 0, 0, 0]);
    expect(countSet(mask)).toBe(3);
  });

  it("marks nothing when no tip is visible", () => {
    expect(countSet(nodeMask(tree, new Uint8Array(5)))).toBe(0);
  });
});

describe("visibleCounts", () => {
  it("counts only the tips that pass the filters", () => {
    const { counts, missing } = visibleCounts(country, Uint8Array.from([1, 0, 1, 1, 0]));

    expect(Array.from(counts)).toEqual([1, 1]);
    expect(missing).toBe(1);
  });
});

describe("nearestTip", () => {
  const positions = computePositions(tree, "rect", "time");
  const grid = buildTipGrid(tree, positions);

  it("finds the tip under the pointer", () => {
    // a1 ở (0,75; 0).
    expect(nearestTip(grid, tree, positions, 0.76, 0.01, 0.05, 0.05)).toBe(0);
  });

  it("returns -1 when no tip is within the radius", () => {
    expect(nearestTip(grid, tree, positions, 0.2, 0.9, 0.05, 0.05)).toBe(-1);
  });

  it("uses a separate radius for each direction", () => {
    // b2 ở (0,9; 0,75): lệch 0,1 theo chiều ngang, nằm trong bán kính ngang 0,2 nhưng ngoài bán kính 0,05.
    expect(nearestTip(grid, tree, positions, 0.8, 0.75, 0.2, 0.01)).toBe(3);
    expect(nearestTip(grid, tree, positions, 0.8, 0.75, 0.05, 0.01)).toBe(-1);
  });

  it("skips tips that are filtered out", () => {
    const visible = Uint8Array.from([0, 1, 1, 1, 1]);

    expect(nearestTip(grid, tree, positions, 0.76, 0.01, 0.05, 0.05, visible)).toBe(-1);
  });

  it("agrees with a scan of every tip on a large random tree, in both layouts", () => {
    const big = parseTree(randomTree(3000, 11));
    for (const layout of ["rect", "radial"] as const) {
      const where = computePositions(big, layout, "time");
      const bigGrid = buildTipGrid(big, where);
      const radius = 0.01;
      for (let n = 0; n < 200; n++) {
        const x = ((n * 7919) % 1000) / 1000;
        const y = ((n * 104729) % 1000) / 1000;
        let expected = -1;
        let best = 1;
        for (let k = 0; k < big.tipCount; k++) {
          const node = big.tipNode[k];
          const distance = ((where.x[node] - x) / radius) ** 2 + ((where.y[node] - y) / radius) ** 2;
          if (distance <= best) {
            best = distance;
            expected = k;
          }
        }
        const found = nearestTip(bigGrid, big, where, x, y, radius, radius);
        // Hai tip cách điểm tìm đúng bằng nhau thì tip nào cũng đúng; so khoảng cách thay vì so chỉ số.
        if (expected === -1) {
          expect(found).toBe(-1);
        } else {
          const node = big.tipNode[found];
          expect(((where.x[node] - x) / radius) ** 2 + ((where.y[node] - y) / radius) ** 2).toBeCloseTo(best, 10);
        }
      }
    }
  });
});
