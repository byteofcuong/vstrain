import { describe, expect, it } from "vitest";

import provincesTsv from "../../../backend/app/geo/data/provinces_vn63.tsv?raw";
import regionsTsv from "../../../backend/app/geo/data/regions.tsv?raw";
import geoBoundaries from "../../map-data/geoBoundaries-VNM-ADM1_simplified.geojson?raw";
import hdx from "../../map-data/hdx-vnm-adm1-snapped.geojson?raw";
import adminUnitsTsv from "./fixtures/admin-units.tsv?raw";
import {
  ARCHIPELAGOS,
  archipelagoOf,
  BOUNDS,
  dissolve,
  features34Of,
  generate,
  projector,
  readUnits,
  rings63Of,
  ringsOf,
  serialize,
  signedArea,
  WIDTH,
  type FeatureCollection,
  type Point,
  type Ring,
} from "./generate";
import type { MapArea, MapData, MapLevel } from "./types";
import asset from "./vn-map.json?raw";

/**
 * Kiểm tra file hình học đã lưu trong repo (`vn-map.json`) và hai file đường biên nó được dựng từ đó.
 * Số mong đợi lấy từ bảng `admin_unit` xuất từ DB và từ chính các file nguồn, không chép cứng.
 */
const LEVELS: MapLevel[] = ["macro", "region", "vn63", "vn34"];
const map = JSON.parse(asset) as MapData;
const provinces63 = JSON.parse(geoBoundaries) as FeatureCollection;
const provinces34 = JSON.parse(hdx) as FeatureCollection;
const units = readUnits(provincesTsv, regionsTsv);
const old = units.filter((unit) => unit.set === "vn63");
const { project } = projector(BOUNDS, WIDTH);

/** Các vòng của một đường vẽ, toạ độ tuyệt đối. */
function parsePath(d: string): Ring[] {
  return d
    .split("z")
    .filter((text) => text !== "")
    .map((part) => {
      const match = /^M(-?\d+) (-?\d+)l((?:-?\d+ -?\d+ ?)+)$/.exec(part);
      if (!match) throw new Error(`Unexpected path segment: ${part.slice(0, 40)}`);
      const steps = match[3].trim().split(" ").map(Number);
      const ring: Ring = [[Number(match[1]), Number(match[2])]];
      for (let k = 0; k < steps.length; k += 2) {
        const [x, y] = ring[ring.length - 1];
        ring.push([x + steps[k], y + steps[k + 1]]);
      }
      ring.push(ring[0]);
      return ring;
    });
}

/** Vị trí các chấm của một địa bàn. */
function parseDots(dots: string | undefined): Point[] {
  return [...(dots ?? "").matchAll(/M(-?\d+) (-?\d+)h0/g)].map((match) => [Number(match[1]), Number(match[2])]);
}

const totalArea = (rings: Ring[]) => Math.abs(rings.reduce((sum, ring) => sum + signedArea(ring), 0));

/** Điểm có nằm trong hình không, theo quy tắc chẵn lẻ trên mọi vòng (như `fill-rule: evenodd`). */
function inside([x, y]: Point, rings: Ring[]): boolean {
  let within = false;
  for (const ring of rings) {
    for (let k = 0; k + 1 < ring.length; k++) {
      const [x1, y1] = ring[k];
      const [x2, y2] = ring[k + 1];
      if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) within = !within;
    }
  }
  return within;
}

/** Diện tích (km²) của các vòng kinh độ, vĩ độ: kinh độ co theo cos của vĩ độ trung bình của từng vòng. */
function squareKm(rings: Ring[]): number {
  const km = 111.195;
  return totalArea(
    rings.map((ring) => {
      const middle = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
      const squeeze = Math.cos((middle * Math.PI) / 180);
      return ring.map(([lon, lat]): Point => [lon * squeeze * km, lat * km]);
    }),
  );
}

/** Các vòng nguồn không thuộc Hoàng Sa, Trường Sa (những vòng được vẽ thành hình, không phải thành chấm). */
const mainland = (rings: Ring[]) => rings.filter((ring) => archipelagoOf(ring[0]) < 0);

/** Điểm của khung vẽ có nằm trong khung của một quần đảo không. */
function inArchipelago([x, y]: Point, index: number): boolean {
  const box = ARCHIPELAGOS[index];
  const [west, north] = project([box.west, box.north]);
  const [east, south] = project([box.east, box.south]);
  return x >= west && x <= east && y >= north && y <= south;
}

describe("vn-map.json", () => {
  it("is what the generator makes from the sources kept in the repository", () => {
    const fresh = generate({ provincesTsv, regionsTsv, provinces63, provinces34 });

    // Lệch ở đây nghĩa là một file nguồn hoặc bộ dựng đã đổi mà chưa chạy lại `npm run build:map`.
    expect(asset).toBe(serialize(fresh));
  });

  it("has every unit of the admin_unit table, under the same code and names (criterion B1)", () => {
    const rows = adminUnitsTsv
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.split("\t"));
    const expected = (level: string, set: string) =>
      rows
        .filter((row) => row[1] === level && row[2] === set)
        .map(([code, , , vi, en, parent, successor]) => ({ code, vi, en, parent, successor }))
        .sort((a, b) => (a.code < b.code ? -1 : 1));
    const found = (level: MapLevel) =>
      map.levels[level].map(({ code, vi, en, parent, successor }) => ({
        code,
        vi,
        en,
        parent: parent ?? "",
        successor: successor ?? "",
      }));

    expect(found("macro")).toEqual(expected("macro_region", ""));
    expect(found("region")).toEqual(expected("region", ""));
    expect(found("vn63")).toEqual(expected("province", "vn63"));
    expect(found("vn34")).toEqual(expected("province", "vn34"));
    expect(LEVELS.map((level) => map.levels[level].length)).toEqual([3, 6, 63, 34]);
  });

  it("gives each of the 34 units its official province code", () => {
    const codes = map.levels.vn34.map((area) => area.pcode);

    expect(codes.every((code) => /^VN\d\d$/.test(code ?? ""))).toBe(true);
    expect(new Set(codes).size).toBe(34);
    expect(map.levels.vn34.find((area) => area.code === "vn34:ha-noi")?.pcode).toBe("VN01");
    expect(map.levels.vn34.find((area) => area.code === "vn34:ho-chi-minh")?.pcode).toBe("VN79");
  });

  it("draws every area with whole-number path commands only", () => {
    for (const level of LEVELS) {
      for (const area of map.levels[level]) {
        expect(area.d, area.code).toMatch(/^(M-?\d+ -?\d+l(-?\d+ -?\d+ ?)+z)+$/);
        if (area.dots !== undefined) expect(area.dots, area.code).toMatch(/^(M-?\d+ -?\d+h0)+$/);
      }
    }
  });
});

describe("merged outlines (criterion B5)", () => {
  const rings63 = rings63Of(units, provinces63);
  const groups: [MapLevel, (province: (typeof old)[number]) => string | undefined][] = [
    ["region", (province) => province.parent],
    ["macro", (province) => units.find((unit) => unit.code === province.parent)?.parent],
  ];

  it("cover exactly the area of the provinces they are made of", () => {
    for (const [level, groupOf] of groups) {
      for (const area of map.levels[level]) {
        const members = old.filter((province) => groupOf(province) === area.code);
        const separate = members.flatMap((province) => rings63.get(province.code)!);
        const merged = dissolve(separate);
        const edges = (rings: Ring[]) => rings.reduce((sum, ring) => sum + ring.length - 1, 0);

        expect(members.length, area.code).toBeGreaterThan(0);
        // Diện tích có dấu: khử đúng cạnh chung thì tổng không đổi, nối sai một vòng là lệch ngay.
        expect(totalArea(merged), area.code).toBeCloseTo(totalArea(separate), 9);
        expect(edges(merged), area.code).toBeLessThan(edges(separate));
        expect(merged.every((ring) => ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1])).toBe(true);
      }
    }
  });

  it("count every province of the 63 once in a region and once in a macro-region", () => {
    for (const [, groupOf] of groups) {
      expect(old.map(groupOf).filter((code) => code !== undefined)).toHaveLength(63);
    }
    expect(map.levels.region.map((area) => old.filter((province) => province.parent === area.code).length)).toEqual([
      5, 13, 14, 14, 11, 6,
    ]);
  });
});

describe("shapes on the drawing grid", () => {
  const rings63 = rings63Of(units, provinces63);
  const features34 = features34Of(units, provinces34);

  /** Các vòng nguồn của một địa bàn, theo kinh độ và vĩ độ. */
  function sourceRings(level: MapLevel, area: MapArea): Ring[] {
    if (level === "vn34") return ringsOf(features34.get(area.code)!.geometry);
    const members = old.filter((province) => {
      if (level === "vn63") return province.code === area.code;
      if (level === "region") return province.parent === area.code;
      return units.find((unit) => unit.code === province.parent)?.parent === area.code;
    });
    return members.flatMap((province) => rings63.get(province.code)!);
  }

  it("keep the area of the source shapes to within two percent", () => {
    for (const level of LEVELS) {
      for (const area of map.levels[level]) {
        const exact = totalArea(mainland(sourceRings(level, area)).map((ring) => ring.map(project)));
        const drawn = totalArea(parsePath(area.d));

        // Tỉnh nhỏ nhất (Bắc Ninh, 823 km²) rộng khoảng 300 ô lưới. Lệch lớn nhất đo được là 1,05% (Trà Vinh).
        expect(Math.abs(drawn / exact - 1), `${area.code}: ${drawn} / ${exact.toFixed(0)}`).toBeLessThan(0.02);
      }
    }
  });

  it("put the anchor point of every area inside its shape", () => {
    for (const level of LEVELS) {
      for (const area of map.levels[level]) {
        expect(inside(area.at, parsePath(area.d)), area.code).toBe(true);
      }
    }
  });

  it("stay inside the frame of the drawing", () => {
    for (const level of LEVELS) {
      for (const area of map.levels[level]) {
        for (const [x, y] of [...parsePath(area.d).flat(), ...parseDots(area.dots)]) {
          expect(x >= 0 && x <= map.width && y >= 0 && y <= map.height, `${area.code} at ${x},${y}`).toBe(true);
        }
      }
    }
  });
});

describe("the 63 to 34 table against the shapes of both sources", () => {
  it("gives each of the 34 units about the area of the provinces merged into it", () => {
    const rings63 = rings63Of(units, provinces63);
    const features34 = features34Of(units, provinces34);

    for (const area of map.levels.vn34) {
      const members = old.filter((province) => province.successor === area.code);
      const fromOld = squareKm(mainland(members.flatMap((province) => rings63.get(province.code)!)));
      const own = squareKm(mainland(ringsOf(features34.get(area.code)!.geometry)));

      // Hai nguồn độc lập (geoBoundaries cho bộ 63, HDX cho bộ 34). Hình của geoBoundaries thô, lệch tới 15% ở
      // tỉnh ven biển (Hải Phòng); xếp nhầm một tỉnh sang đơn vị khác làm lệch nhiều hơn thế ở đơn vị nhỏ hơn.
      expect(members.length, area.code).toBeGreaterThan(0);
      expect(Math.abs(fromOld / own - 1), `${area.code}: ${fromOld.toFixed(0)} / ${own.toFixed(0)} km²`).toBeLessThan(
        0.2,
      );
    }
  });
});

describe("Hoàng Sa and Trường Sa (criterion B6)", () => {
  /** Mã của các địa bàn có chấm nằm trong khung của một quần đảo. */
  const owners = (level: MapLevel, index: number) =>
    map.levels[level]
      .filter((area) => parseDots(area.dots).some((dot) => inArchipelago(dot, index)))
      .map((area) => area.code);

  it("belong to Đà Nẵng and Khánh Hòa, and to the areas that contain those two", () => {
    expect(LEVELS.map((level) => owners(level, 0))).toEqual([
      ["vnm:central"],
      ["vnr:north-central-and-central-coast"],
      ["vn63:da-nang"],
      ["vn34:da-nang"],
    ]);
    expect(LEVELS.map((level) => owners(level, 1))).toEqual([
      ["vnm:central"],
      ["vnr:north-central-and-central-coast"],
      ["vn63:khanh-hoa"],
      ["vn34:khanh-hoa"],
    ]);
  });

  it("show the same islands at every level, taken from the more detailed of the two sources", () => {
    const dotsAt = (level: MapLevel, index: number) =>
      map.levels[level].flatMap((area) => parseDots(area.dots).filter((dot) => inArchipelago(dot, index)));

    for (const index of [0, 1]) {
      for (const level of LEVELS) {
        expect(dotsAt(level, index), `${ARCHIPELAGOS[index].vi}, ${level}`).toEqual(dotsAt("vn34", index));
      }
    }
    // File HDX có 18 hình ở Hoàng Sa và gần 300 hình ở Trường Sa; file geoBoundaries có 8 và 9.
    expect(dotsAt("vn63", 0).length).toBeGreaterThan(8);
    expect(dotsAt("vn63", 1).length).toBeGreaterThan(100);
  });

  it("are drawn as dots only, each dot in the waters of one of the two", () => {
    for (const level of LEVELS) {
      for (const area of map.levels[level]) {
        for (const dot of parseDots(area.dots)) {
          expect(inArchipelago(dot, 0) || inArchipelago(dot, 1), `${area.code} dot at ${dot}`).toBe(true);
        }
        for (const point of parsePath(area.d).flat()) {
          expect(inArchipelago(point, 0) || inArchipelago(point, 1), `${area.code} shape at ${point}`).toBe(false);
        }
      }
    }
  });

  it("are labelled, each label anchored at the northern edge of its islands so the text can sit above them", () => {
    expect(map.labels.map((label) => [label.vi, label.en])).toEqual([
      ["Quần đảo Hoàng Sa", "Hoàng Sa Islands"],
      ["Quần đảo Trường Sa", "Trường Sa Islands"],
    ]);
    map.labels.forEach((label, index) => {
      const dots = map.levels.vn34.flatMap((area) => parseDots(area.dots).filter((dot) => inArchipelago(dot, index)));
      const xs = dots.map((dot) => dot[0]);

      expect(inArchipelago(label.at, index), label.vi).toBe(true);
      expect(label.at[1], label.vi).toBe(Math.min(...dots.map((dot) => dot[1])));
      expect(label.at[0] > Math.min(...xs) && label.at[0] < Math.max(...xs), label.vi).toBe(true);
    });
  });
});
