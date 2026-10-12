import { describe, expect, it } from "vitest";

import { parseColumn, type Column } from "../tree/columns";
import { areaMask, countAreas, coverage, defaultLevel, homeMask, placeTips, selectionMask } from "./placement";
import type { MapArea, MapData, MapLevel } from "./types";

/**
 * Một nước nhỏ dựng tay. Bộ cũ có năm tỉnh trong ba vùng của hai miền; bộ mới có ba đơn vị:
 *   Đông  = Đông (vùng A) + Tây (vùng A)       cùng vùng
 *   Giữa  = Bắc (vùng A) + Trung (vùng B)      hai vùng của cùng miền Bắc
 *   Biển  = Nam (vùng C, miền Nam)             một tỉnh
 */
const area = (code: string, more: Partial<MapArea> = {}): MapArea => ({
  code,
  vi: code,
  en: code,
  d: "",
  at: [0, 0],
  ...more,
});
const map: MapData = {
  width: 100,
  height: 100,
  labels: [],
  sources: [],
  levels: {
    macro: [area("vnm:north"), area("vnm:south")],
    region: [
      area("vnr:a", { parent: "vnm:north" }),
      area("vnr:b", { parent: "vnm:north" }),
      area("vnr:c", { parent: "vnm:south" }),
    ],
    vn63: [
      area("vn63:bac", { parent: "vnr:a", successor: "vn34:giua" }),
      area("vn63:dong", { parent: "vnr:a", successor: "vn34:dong" }),
      area("vn63:nam", { parent: "vnr:c", successor: "vn34:bien" }),
      area("vn63:tay", { parent: "vnr:a", successor: "vn34:dong" }),
      area("vn63:trung", { parent: "vnr:b", successor: "vn34:giua" }),
    ],
    vn34: [area("vn34:bien"), area("vn34:dong"), area("vn34:giua")],
  },
};
const LEVELS: MapLevel[] = ["macro", "region", "vn63", "vn34"];

/** Một cột của tip: mỗi tip một giá trị (hoặc `null`). */
function column(key: string, cells: (string | null)[]): Column {
  const values = [...new Set(cells.filter((cell) => cell !== null))];
  const codes = cells.map((cell) => (cell === null ? -1 : values.indexOf(cell)));
  const tipNode = Int32Array.from(cells, (_, index) => index);
  return parseColumn(
    { key, scope: "tip", values, codes },
    { nodeCount: cells.length, tipCount: cells.length, tipNode },
  );
}

/** Mã địa bàn của từng tip ở một cấp (`null` là không xếp được), cho dễ đọc trong test. */
function placed(level: MapLevel, units: (string | null)[], regions: (string | null)[]): (string | null)[] {
  const tips = placeTips(map, level, column("unit", units), column("region", regions));
  return Array.from(tips, (index) => (index < 0 ? null : map.levels[level][index].code));
}

describe("placeTips", () => {
  it("places a tip that has an old province at every level, through the province's parents and successor", () => {
    const at = (level: MapLevel) => placed(level, ["vn63:tay"], ["vnr:a"])[0];

    expect(LEVELS.map(at)).toEqual(["vnm:north", "vnr:a", "vn63:tay", "vn34:dong"]);
  });

  it("places a tip that has a current unit in that unit, and not in any one old province", () => {
    expect(placed("vn34", ["vn34:giua"], [null])).toEqual(["vn34:giua"]);
    expect(placed("vn63", ["vn34:giua"], [null])).toEqual([null]);
  });

  it("places a current unit in a region or macro-region only when all the provinces merged into it lie there", () => {
    // Đông gộp hai tỉnh cùng vùng A; Giữa gộp tỉnh của vùng A và vùng B, cả hai thuộc miền Bắc.
    expect(placed("region", ["vn34:dong", "vn34:giua", "vn34:bien"], [null, null, null])).toEqual([
      "vnr:a",
      null,
      "vnr:c",
    ]);
    expect(placed("macro", ["vn34:dong", "vn34:giua", "vn34:bien"], [null, null, null])).toEqual([
      "vnm:north",
      "vnm:north",
      "vnm:south",
    ]);
  });

  it("places a tip known only by region at the region and above, never in a province", () => {
    expect(LEVELS.map((level) => placed(level, [null], ["vnr:b"])[0])).toEqual(["vnm:north", "vnr:b", null, null]);
  });

  it("places a tip known only by macro-region at that level alone", () => {
    expect(LEVELS.map((level) => placed(level, [null], ["vnm:south"])[0])).toEqual(["vnm:south", null, null, null]);
  });

  it("uses the region column for a current unit whose provinces lie in two regions", () => {
    expect(placed("region", ["vn34:giua"], ["vnr:b"])).toEqual(["vnr:b"]);
  });

  it("trusts the province over the region column when the two disagree, so levels add up", () => {
    // Tỉnh Đông thuộc vùng A; cột vùng ghi nhầm vùng C.
    expect(placed("region", ["vn63:dong"], ["vnr:c"])).toEqual(["vnr:a"]);
    expect(placed("macro", ["vn63:dong"], ["vnr:c"])).toEqual(["vnm:north"]);
  });

  it("leaves out tips with no place, and codes the map does not know", () => {
    for (const level of LEVELS) {
      expect(placed(level, [null, "vn63:atlantis", "xx:1"], [null, "vnr:nowhere", null]), level).toEqual([
        null,
        null,
        null,
      ]);
    }
  });

  it("works with one of the two columns missing, and places nothing without both", () => {
    const units = column("unit", ["vn63:nam", null]);
    const regions = column("region", ["vnr:c", "vnm:north"]);

    expect(Array.from(placeTips(map, "macro", units, null))).toEqual([1, -1]);
    expect(Array.from(placeTips(map, "macro", null, regions))).toEqual([1, 0]);
    expect(placeTips(map, "macro", null, null)).toHaveLength(0);
  });
});

describe("countAreas", () => {
  it("counts the tips of each area, all of them and the ones that pass the filters", () => {
    // Năm tip: hai ở địa bàn 0, hai ở địa bàn 2, một không xếp được; tip thứ hai và thứ tư đang bị lọc.
    const counts = countAreas(Int32Array.from([0, 0, 2, 2, -1]), 3, Uint8Array.from([1, 0, 1, 0, 1]));

    expect(Array.from(counts.total)).toEqual([2, 0, 2]);
    expect(Array.from(counts.visible)).toEqual([1, 0, 1]);
  });
});

describe("coverage", () => {
  it("says how many of the home country's visible tips are placed at this level", () => {
    const home = homeMask(column("country", ["Vietnam", "Vietnam", "Thailand", "Vietnam", null]), "Vietnam")!;
    const tips = Int32Array.from([0, -1, -1, 1, -1]);

    expect(coverage(tips, home, Uint8Array.from([1, 1, 1, 1, 1]))).toEqual({ home: 3, placed: 2 });
    expect(coverage(tips, home, Uint8Array.from([0, 1, 1, 1, 1]))).toEqual({ home: 2, placed: 1 });
  });

  it("counts only placed tips when the dataset has no country column", () => {
    expect(homeMask(null, "Vietnam")).toBeNull();
    expect(coverage(Int32Array.from([0, -1, 1]), null, Uint8Array.from([1, 1, 0]))).toEqual({ home: null, placed: 1 });
  });

  it("has no home tips when the country is not among the values of the column", () => {
    const home = homeMask(column("country", ["Laos", "Thailand"]), "Vietnam")!;

    expect(coverage(Int32Array.from([-1, -1]), home, Uint8Array.from([1, 1]))).toEqual({ home: 0, placed: 0 });
  });
});

describe("areaMask", () => {
  it("keeps the tips placed in one of the selected areas", () => {
    const tips = Int32Array.from([0, 1, 2, -1, 1]);

    expect(Array.from(areaMask(tips, [1]))).toEqual([0, 1, 0, 0, 1]);
    expect(Array.from(areaMask(tips, [0, 2]))).toEqual([1, 0, 1, 0, 0]);
    expect(Array.from(areaMask(tips, []))).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("selectionMask", () => {
  const units = column("unit", ["vn63:dong", "vn63:nam", null, "vn34:giua"]);
  const regions = column("region", ["vnr:a", "vnr:c", "vnm:south", null]);

  it("keeps the tips placed in the selected areas, at the level of the selection", () => {
    expect(Array.from(selectionMask(map, { level: "macro", codes: ["vnm:south"] }, units, regions))).toEqual([
      0, 1, 1, 0,
    ]);
    expect(
      Array.from(selectionMask(map, { level: "vn34", codes: ["vn34:dong", "vn34:giua"] }, units, regions)),
    ).toEqual([1, 0, 0, 1]);
  });

  it("keeps nothing for an area the map does not have", () => {
    expect(Array.from(selectionMask(map, { level: "region", codes: ["vnr:nowhere"] }, units, regions))).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

describe("defaultLevel", () => {
  it("opens at the finest level that places at least half of the home tips", () => {
    expect(defaultLevel({ macro: 90, region: 60, vn34: 50 }, 100)).toBe("vn34");
    expect(defaultLevel({ macro: 90, region: 60, vn34: 49 }, 100)).toBe("region");
    // Build DENV1: 1.489 mẫu Việt Nam, 925 xếp được theo miền, 209 theo vùng và theo tỉnh.
    expect(defaultLevel({ macro: 925, region: 209, vn34: 209 }, 1489)).toBe("macro");
  });

  it("falls back to the level that places most, the finer one on a tie", () => {
    expect(defaultLevel({ macro: 40, region: 30, vn34: 10 }, 100)).toBe("macro");
    expect(defaultLevel({ macro: 30, region: 30, vn34: 10 }, 100)).toBe("region");
    expect(defaultLevel({ macro: 0, region: 0, vn34: 0 }, 100)).toBe("vn34");
  });

  it("uses the number of placed tips when the number of home tips is not known", () => {
    expect(defaultLevel({ macro: 40, region: 30, vn34: 25 }, null)).toBe("vn34");
    expect(defaultLevel({ macro: 40, region: 10, vn34: 5 }, null)).toBe("macro");
  });
});
