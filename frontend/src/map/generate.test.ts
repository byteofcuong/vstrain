import { describe, expect, it } from "vitest";

import provincesTsv from "../../../backend/app/geo/data/provinces_vn63.tsv?raw";
import regionsTsv from "../../../backend/app/geo/data/regions.tsv?raw";
import adminUnitsTsv from "./fixtures/admin-units.tsv?raw";
import {
  BOUNDS,
  dissolve,
  dotsOf,
  generate,
  interiorPoint,
  pathOf,
  placeKey,
  projector,
  readUnits,
  ringsOf,
  serialize,
  signedArea,
  snapGeometry,
  stripDiacritics,
  toGrid,
  unitCode,
  WIDTH,
  type Point,
  type Ring,
} from "./generate";

/** Ô vuông cạnh 1 có góc dưới trái ở (x, y), đi ngược chiều kim đồng hồ. */
function square(x: number, y: number, size = 1): Ring {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];
}

const reversed = (ring: Ring): Ring => [...ring].reverse();
const totalArea = (rings: Ring[]) => rings.reduce((sum, ring) => sum + signedArea(ring), 0);
const isClosed = (ring: Ring) => ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1];

/** Điểm có nằm trong vòng không (đếm số lần tia ngang cắt cạnh). */
function inside([x, y]: Point, ring: Ring): boolean {
  let within = false;
  for (let k = 0; k + 1 < ring.length; k++) {
    const [x1, y1] = ring[k];
    const [x2, y2] = ring[k + 1];
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) within = !within;
  }
  return within;
}

describe("names and codes", () => {
  it("strips Vietnamese diacritics, including the letter đ", () => {
    expect(stripDiacritics("Đắk Lắk")).toBe("Dak Lak");
    expect(stripDiacritics("Thừa Thiên Huế")).toBe("Thua Thien Hue");
    expect(stripDiacritics("Bà Rịa - Vũng Tàu")).toBe("Ba Ria - Vung Tau");
    // Chữ đ thường không tách được thành d cộng dấu, phải thay riêng.
    expect(stripDiacritics("quần đảo")).toBe("quan dao");
  });

  it("gives every spelling of a place the same key", () => {
    expect(placeKey("Đắk Lắk")).toBe("daklak");
    expect(placeKey("Dak Lak Province")).toBe("daklak");
    expect(placeKey("TP. Hồ Chí Minh")).toBe("hochiminh");
    expect(placeKey("Thành phố Hồ Chí Minh")).toBe("hochiminh");
    expect(placeKey("Ho Chi Minh city")).toBe("hochiminh");
    expect(placeKey("Bà Rịa–Vũng Tàu")).toBe(placeKey("Bà Rịa - Vũng Tàu"));
    expect(placeKey("Hà Nội\t")).toBe("hanoi");
    expect(placeKey("đà nẵng")).toBe("danang");
  });

  it("does not take part of a name for an administrative word", () => {
    // "Thanh Hóa" không phải "Thành phố ...", "Hà Tĩnh" không có tiền tố "Tỉnh".
    expect(placeKey("Thanh Hóa")).toBe("thanhhoa");
    expect(placeKey("Hà Tĩnh")).toBe("hatinh");
    expect(placeKey("Tỉnh")).toBe("tinh");
  });

  it("builds the unit code the backend builds", () => {
    expect(unitCode("vn63", "Bà Rịa - Vũng Tàu")).toBe("vn63:ba-ria-vung-tau");
    expect(unitCode("vn34", "Hồ Chí Minh")).toBe("vn34:ho-chi-minh");
    expect(unitCode("vn63", "Đắk Lắk")).toBe("vn63:dak-lak");
  });

  it("reads the seed files into the same units as the admin_unit table", () => {
    // `admin-units.tsv` là bảng `admin_unit` xuất từ DB (đã nạp bằng `seed-geo` của backend).
    const expected = adminUnitsTsv
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [code, level, set, vi, en, parent, successor] = line.split("\t");
        return { code, level, set, vi, en, parent, successor };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    const units = readUnits(provincesTsv, regionsTsv)
      .map(({ code, level, set, vi, en, parent, successor }) => ({
        code,
        level,
        set: set ?? "",
        vi,
        en,
        parent: parent ?? "",
        successor: successor ?? "",
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    expect(units).toHaveLength(106);
    expect(units).toEqual(expected);
  });
});

describe("ringsOf", () => {
  it("lists the outer rings and the holes of a polygon and of a multipolygon", () => {
    const hole = reversed(square(1, 1));
    expect(ringsOf({ type: "Polygon", coordinates: [square(0, 0, 3), hole] })).toEqual([square(0, 0, 3), hole]);
    expect(
      ringsOf({
        type: "MultiPolygon",
        coordinates: [[square(0, 0)], [square(5, 5, 3), hole.map(([x, y]) => [x + 5, y + 5])]],
      }),
    ).toHaveLength(3);
  });
});

describe("dissolve", () => {
  it("merges two shapes that share a border into one ring", () => {
    const merged = dissolve([square(0, 0), square(1, 0)]);

    expect(merged).toHaveLength(1);
    expect(isClosed(merged[0])).toBe(true);
    expect(signedArea(merged[0])).toBe(2);
    // Cạnh chung (1,0)–(1,1) biến mất, sáu cạnh ngoài còn lại.
    expect(merged[0]).toHaveLength(7);
  });

  it("keeps a hole where the merged shapes surround an area that is not theirs", () => {
    // Tám ô quanh ô giữa của lưới 3 × 3.
    const around = [0, 1, 2].flatMap((x) => [0, 1, 2].filter((y) => !(x === 1 && y === 1)).map((y) => square(x, y)));

    const merged = dissolve(around);

    expect(merged).toHaveLength(2);
    expect(merged.every(isClosed)).toBe(true);
    expect(merged.map(signedArea).sort((a, b) => a - b)).toEqual([-1, 9]);
  });

  it("fills a hole with the shape that sits in it", () => {
    const merged = dissolve([square(0, 0, 3), reversed(square(1, 1)), square(1, 1)]);

    expect(merged).toHaveLength(1);
    expect(signedArea(merged[0])).toBe(9);
  });

  it("leaves apart the shapes that do not touch, or touch at one point only", () => {
    const apart = dissolve([square(0, 0), square(5, 5)]);
    const corner = dissolve([square(0, 0), square(1, 1)]);

    expect(apart).toHaveLength(2);
    expect(totalArea(apart)).toBe(2);
    expect(corner.every(isClosed)).toBe(true);
    expect(totalArea(corner)).toBe(2);
  });

  it("refuses shapes that overlap, since their common border cannot be told from an outer one", () => {
    expect(() => dissolve([square(0, 0), square(0, 0)])).toThrow(/overlap/);
  });
});

describe("projector", () => {
  const { project, height } = projector({ west: 100, east: 110, south: 10, north: 20, middle: 60 }, 1000);

  it("puts the north-west corner at the origin and the east edge at the full width", () => {
    expect(project([100, 20])).toEqual([0, 0]);
    expect(project([110, 20])[0]).toBeCloseTo(1000, 9);
    expect(project([100, 10])[1]).toBeCloseTo(height, 9);
  });

  it("shrinks longitude by the cosine of the middle latitude, so shapes keep their proportions there", () => {
    // Ở vĩ độ 60, một độ kinh dài bằng nửa một độ vĩ: 10 độ kinh là 1000 đơn vị thì 10 độ vĩ là 2000.
    expect(height).toBeCloseTo(2000, 9);
  });
});

describe("toGrid", () => {
  const same = (point: Point): Point => point;

  it("rounds to whole units and drops the points that fall together", () => {
    const { rings, specks } = toGrid(
      [
        [
          [0.2, 0.1],
          [0.4, -0.3],
          [4.2, 0.3],
          [3.9, 3.1],
          [0.2, 0.1],
        ],
      ],
      same,
    );

    expect(rings).toEqual([
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 0],
      ],
    ]);
    expect(specks).toEqual([]);
  });

  it("removes a spur that goes out and comes back along the same line", () => {
    const { rings } = toGrid(
      [
        [
          [0, 0],
          [4, 0],
          [4, 2],
          [7.2, 2.1],
          [3.9, 2.2],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
      same,
    );

    expect(rings).toEqual([
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ],
    ]);
  });

  it("turns a ring too small to keep its shape into a speck at its place", () => {
    const tiny: Ring = [
      [7.1, 3.1],
      [7.3, 3.1],
      [7.2, 3.3],
      [7.1, 3.1],
    ];
    const sliver: Ring = [
      [20, 10],
      [26, 10.2],
      [20, 10.4],
      [20, 10],
    ];

    const { rings, specks } = toGrid([tiny, square(0, 0, 5), sliver], same);

    expect(rings).toEqual([square(0, 0, 5)]);
    expect(specks).toEqual([
      [7, 3],
      [22, 10],
    ]);
  });

  it("starts a ring at its westernmost, then northernmost, corner, wherever the source ring starts", () => {
    const ring = square(3, 7, 2);
    const turned: Ring = [...ring.slice(2, -1), ...ring.slice(0, 2), ring[2]];

    // Trong khung vẽ y tăng về phía nam, nên trong hai góc có x nhỏ nhất, góc có y nhỏ hơn là góc bắc.
    expect(toGrid([ring], same).rings).toEqual([square(3, 7, 2)]);
    expect(toGrid([turned], same).rings).toEqual([square(3, 7, 2)]);
  });

  it("applies the projection before rounding", () => {
    const { rings } = toGrid([square(0, 0)], ([x, y]) => [x * 10, y * 10]);

    expect(rings).toEqual([square(0, 0, 10)]);
  });
});

describe("snapGeometry", () => {
  /** Vòng tam giác nhỏ hơn nhiều so với bước lưới. */
  const dot = (lon: number, lat: number): Ring => [
    [lon, lat],
    [lon + 0.001, lat],
    [lon, lat + 0.001],
    [lon, lat],
  ];

  it("moves every vertex to the grid and keeps the holes with their polygon", () => {
    const outer: Ring = [
      [104.02, 10.01],
      [106.98, 9.99],
      [107.01, 13.02],
      [104.01, 12.98],
      [104.02, 10.01],
    ];
    const hole: Ring = [
      [105.01, 11.02],
      [105.02, 11.98],
      [105.99, 12.01],
      [106.01, 10.99],
      [105.01, 11.02],
    ];

    const snapped = snapGeometry({ type: "Polygon", coordinates: [outer, hole] }, 0.5);

    expect(snapped.islets).toEqual([]);
    expect(snapped.geometry).toEqual({
      type: "MultiPolygon",
      coordinates: [[square(104, 10, 3), reversed(square(105, 11))]],
    });
  });

  it("writes coordinates as short decimals, without the noise of binary fractions", () => {
    const snapped = snapGeometry({ type: "Polygon", coordinates: [square(104.853, 10.377, 0.1)] }, 0.01);

    // 10485 × 0,01 trong số thực nhị phân là 104,85000000000001.
    expect(JSON.stringify(snapped.geometry)).toBe(
      '{"type":"MultiPolygon","coordinates":[[[[104.85,10.38],[104.95,10.38],[104.95,10.48],[104.85,10.48],[104.85,10.38]]]]}',
    );
  });

  it("drops a polygon that collapses, but remembers where it was when it belongs to an archipelago", () => {
    const snapped = snapGeometry(
      {
        type: "MultiPolygon",
        coordinates: [[square(108, 10)], [dot(112.03, 16.52)], [dot(114.31, 10.38)], [dot(107.2, 15.1)]],
      },
      0.1,
    );

    expect(snapped.geometry).toEqual({ type: "MultiPolygon", coordinates: [[square(108, 10)]] });
    // Hoàng Sa và Trường Sa; đảo nhỏ ở 107,2 độ kinh nằm sát bờ nên bị bỏ.
    expect(snapped.islets).toEqual([
      [112, 16.5],
      [114.3, 10.4],
    ]);
  });

  it("drops a hole that collapses and keeps the polygon around it", () => {
    const snapped = snapGeometry({ type: "Polygon", coordinates: [square(104, 10, 3), reversed(dot(105, 11))] }, 0.5);

    expect(snapped.geometry).toEqual({ type: "MultiPolygon", coordinates: [[square(104, 10, 3)]] });
  });

  it("has no geometry left when every polygon collapses", () => {
    const snapped = snapGeometry({ type: "Polygon", coordinates: [dot(107.2, 15.1)] }, 0.5);

    expect(snapped.geometry).toBeNull();
    expect(snapped.islets).toEqual([]);
  });
});

describe("pathOf", () => {
  it("writes rings as one path with relative whole-number steps", () => {
    const triangle: Ring = [
      [10, 20],
      [14, 20],
      [14, 17],
      [10, 20],
    ];

    expect(pathOf([triangle])).toBe("M10 20l4 0 0 -3z");
    expect(pathOf([triangle, square(0, 0, 2)])).toBe("M10 20l4 0 0 -3zM0 0l2 0 0 2 -2 0z");
  });
});

describe("dotsOf", () => {
  it("writes each point as a segment of no length, which a round line cap turns into a dot", () => {
    expect(
      dotsOf([
        [50, 60],
        [7, 8],
      ]),
    ).toBe("M50 60h0M7 8h0");
    expect(dotsOf([])).toBe("");
  });
});

describe("interiorPoint", () => {
  it("is the centre of a convex shape", () => {
    expect(interiorPoint([square(10, 20, 4)])).toEqual([12, 22]);
  });

  it("stays inside a shape whose centre of mass is outside it", () => {
    // Hình chữ U: khối tâm rơi vào khoảng trống giữa hai nhánh.
    const u: Ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [8, 10],
      [8, 2],
      [2, 2],
      [2, 10],
      [0, 10],
      [0, 0],
    ];

    expect(inside(interiorPoint([u]), u)).toBe(true);
  });

  it("uses the largest of several rings", () => {
    const point = interiorPoint([square(100, 100, 2), square(0, 0, 20), square(50, 50, 3)]);

    expect(inside(point, square(0, 0, 20))).toBe(true);
  });
});

describe("generate", () => {
  const regions = [
    "code\tlevel\tname_vi\tname_en\tparent\taliases",
    "vnm:north\tmacro_region\tMiền Bắc\tNorthern Vietnam\t\t",
    "vnm:south\tmacro_region\tMiền Nam\tSouthern Vietnam\t\t",
    "vnr:a\tregion\tVùng A\tRegion A\tvnm:north\t",
    "vnr:b\tregion\tVùng B\tRegion B\tvnm:north\t",
    "vnr:c\tregion\tVùng C\tRegion C\tvnm:south\t",
  ].join("\n");
  // Đông và Tây cùng vùng A và cùng gộp vào đơn vị Đông của bộ mới.
  const provinces = [
    "name_vi\tregion\tsuccessor\tvariants",
    "Đông\tvnr:a\tĐông\t",
    "Tây\tvnr:a\tĐông\tWest|Tay Province",
    "Nam\tvnr:b\tNam\t",
    "Hải Đảo\tvnr:c\tHải Đảo\t",
  ].join("\n");

  /** Ô vuông một độ có góc tây nam ở (lon, lat). */
  const cell = (lon: number, lat: number) => ({ type: "Polygon" as const, coordinates: [square(lon, lat)] });
  /** Một hòn đảo quá nhỏ để còn hình sau khi đưa về lưới. */
  const islet = (lon: number, lat: number): Ring => [
    [lon, lat],
    [lon + 0.001, lat],
    [lon, lat + 0.001],
    [lon, lat],
  ];
  const old = {
    features: [
      { properties: { shapeName: "Đông" }, geometry: cell(105, 20) },
      { properties: { shapeName: "West" }, geometry: cell(104, 20) },
      { properties: { shapeName: "Nam" }, geometry: cell(104, 19) },
      {
        properties: { shapeName: "Hai Dao" },
        geometry: {
          type: "MultiPolygon" as const,
          // Đảo chính, một đảo nhỏ ở Hoàng Sa và một đảo nhỏ sát bờ.
          coordinates: [[square(108, 10)], [islet(112, 16.5)], [islet(107, 15)]],
        },
      },
    ],
  };
  const current = {
    features: [
      { properties: { name_vi: "TP. Đông", pcode: "VN01" }, geometry: cell(104, 20) },
      { properties: { name_vi: "Nam", pcode: "VN02" }, geometry: cell(104, 19) },
      { properties: { name_vi: "Hải Đảo", pcode: "VN03", islets: [[112, 16.5]] }, geometry: cell(108, 10) },
    ],
  };
  const sources = { provincesTsv: provinces, regionsTsv: regions, provinces63: old, provinces34: current };
  const { project } = projector(BOUNDS, WIDTH);
  const at = (lon: number, lat: number) => project([lon, lat]).map(Math.round) as Point;
  const ringCount = (d: string) => d.split("M").length - 1;
  /** Đường vẽ của một vòng đi qua các điểm cho trước; vòng bắt đầu ở đỉnh tây nhất, rồi bắc nhất. */
  const outline = (...points: Point[]) =>
    `M${points[0][0]} ${points[0][1]}l${points
      .slice(1)
      .map((point, k) => `${point[0] - points[k][0]} ${point[1] - points[k][1]}`)
      .join(" ")}z`;

  it("draws each of the 63 provinces from the shape that carries one of its names", () => {
    const map = generate(sources);

    expect(map.levels.vn63.map((area) => area.code)).toEqual(["vn63:dong", "vn63:hai-dao", "vn63:nam", "vn63:tay"]);
    const west = map.levels.vn63[3];
    expect(west).toMatchObject({ vi: "Tây", en: "Tay", parent: "vnr:a", successor: "vn34:dong" });
    // Ô 104–105 độ kinh, 20–21 độ vĩ.
    expect(west.d).toBe(outline(at(104, 21), at(104, 20), at(105, 20), at(105, 21)));
    expect(inside(west.at, [at(104, 20), at(105, 20), at(105, 21), at(104, 21), at(104, 20)])).toBe(true);
  });

  it("merges the provinces of a region, and the regions of a macro-region, into one outline", () => {
    const map = generate(sources);

    expect(map.levels.region.map((area) => [area.code, area.vi, area.parent])).toEqual([
      ["vnr:a", "Vùng A", "vnm:north"],
      ["vnr:b", "Vùng B", "vnm:north"],
      ["vnr:c", "Vùng C", "vnm:south"],
    ]);
    expect(map.levels.macro.map((area) => [area.code, area.en])).toEqual([
      ["vnm:north", "Northern Vietnam"],
      ["vnm:south", "Southern Vietnam"],
    ]);
    // Vùng A là hai ô kề nhau; miền Bắc là ba ô xếp hình chữ L. Mỗi hình chỉ còn một vòng.
    expect(map.levels.region[0].d).toBe(outline(at(104, 21), at(104, 20), at(106, 20), at(106, 21)));
    expect(map.levels.macro[0].d).toBe(
      outline(at(104, 21), at(104, 19), at(105, 19), at(105, 20), at(106, 20), at(106, 21)),
    );
  });

  it("takes the 34 units from their own file, with the official code", () => {
    const map = generate(sources);

    expect(map.levels.vn34.map((area) => [area.code, area.vi, area.pcode])).toEqual([
      ["vn34:dong", "Đông", "VN01"],
      ["vn34:hai-dao", "Hải Đảo", "VN03"],
      ["vn34:nam", "Nam", "VN02"],
    ]);
    expect(map.levels.vn34[0].parent).toBeUndefined();
  });

  it("draws the islands of the two archipelagos as dots and drops other islets too small to draw", () => {
    const map = generate(sources);
    const [x, y] = at(112, 16.5);

    for (const level of ["vn63", "vn34", "region", "macro"] as const) {
      const owners = map.levels[level].filter((area) => area.dots !== undefined);
      expect(
        owners.map((area) => area.code),
        level,
      ).toEqual([{ vn63: "vn63:hai-dao", vn34: "vn34:hai-dao", region: "vnr:c", macro: "vnm:south" }[level]]);
      expect(owners[0].dots, level).toBe(`M${x} ${y}h0`);
      // Chỉ đảo chính có hình; đảo nhỏ sát bờ không được vẽ.
      expect(ringCount(owners[0].d), level).toBe(1);
    }
    expect(map.labels).toEqual([{ vi: "Quần đảo Hoàng Sa", en: "Hoàng Sa Islands", at: [x, y] }]);
  });

  it("draws an island of an archipelago as a dot even when it is large enough to keep a shape", () => {
    // Một đảo rộng nửa độ ở Trường Sa: trên bản đồ nó vẫn chỉ là vài pixel, nên cũng vẽ thành chấm ở tâm của nó.
    const reef = {
      properties: { shapeName: "Hai Dao" },
      geometry: { type: "MultiPolygon" as const, coordinates: [[square(108, 10)], [square(114, 9, 0.5)]] },
    };
    const withReef = { features: [...old.features.slice(0, 3), reef] };
    const [x, y] = at(114.25, 9.25);

    const island = generate({ ...sources, provinces63: withReef }).levels.vn63[1];

    expect(island.dots).toBe(`M${x} ${y}h0`);
    expect(ringCount(island.d)).toBe(1);
  });

  it("is written as JSON with one area on each line, and reads back the same", () => {
    const map = generate(sources);

    const text = serialize(map);

    expect(JSON.parse(text)).toEqual(map);
    // 2 miền, 3 vùng, 4 tỉnh bộ cũ, 3 đơn vị bộ mới.
    expect(text.split("\n").filter((line) => line.startsWith('{"code"'))).toHaveLength(12);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("reports the size of the drawing and where the shapes come from", () => {
    const map = generate(sources);

    expect(map.width).toBe(WIDTH);
    expect(map.height).toBe(Math.round(projector(BOUNDS, WIDTH).height));
    expect(map.sources.map((source) => source.levels)).toEqual([["vn34"], ["vn63", "region", "macro"]]);
  });

  it("refuses a shape whose name matches no province, and a province left without a shape", () => {
    const stray = { features: [...old.features, { properties: { shapeName: "Atlantis" }, geometry: cell(100, 10) }] };
    const short = { features: old.features.slice(1) };

    expect(() => generate({ ...sources, provinces63: stray })).toThrow(/Atlantis/);
    expect(() => generate({ ...sources, provinces63: short })).toThrow(/vn63:dong/);
    expect(() => generate({ ...sources, provinces34: { features: current.features.slice(1) } })).toThrow(/vn34:dong/);
  });
});
