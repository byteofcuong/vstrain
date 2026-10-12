/**
 * Dựng file hình học của bản đồ (`vn-map.json`) từ hai file đường biên và các file seed địa danh của backend.
 * Chỉ chạy lúc phát triển (`npm run build:map`), không nằm trong bundle của trình duyệt.
 *
 * File này không import module nào khác lúc chạy: Node chạy thẳng nó (bỏ kiểu TypeScript) từ `scripts/build-map.mjs`.
 */

import type { MapArea, MapData, MapLabel, MapLevel } from "./types";

// Tên và mã: chép đúng quy tắc của backend (`app/geo/normalize.py`, `app/geo/seed.py`). Test so kết quả với bảng
// `admin_unit` xuất từ DB.

const PREFIXES = [["thanh", "pho"], ["tinh"], ["tp"]];
const SUFFIXES = [["province"], ["city"]];

/** Bỏ dấu tiếng Việt. Chữ đ không tách được bằng NFD nên phải thay riêng. */
export function stripDiacritics(text: string): string {
  return text
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

function words(text: string): string[] {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .split(" ")
    .filter((word) => word !== "");
}

/** Khoá so khớp của một tên địa danh: mọi cách viết của cùng một nơi cho cùng một khoá. */
export function placeKey(name: string): string {
  let tokens = words(name);
  const startsWith = (prefix: string[]) => prefix.every((word, index) => tokens[index] === word);
  const endsWith = (suffix: string[]) =>
    suffix.every((word, index) => tokens[tokens.length - suffix.length + index] === word);
  // Chỉ cắt khi còn lại ít nhất một từ: tên toàn từ hành chính vẫn phải cho khoá khác rỗng.
  const prefix = PREFIXES.find((candidate) => tokens.length > candidate.length && startsWith(candidate));
  if (prefix) tokens = tokens.slice(prefix.length);
  const suffix = SUFFIXES.find((candidate) => tokens.length > candidate.length && endsWith(candidate));
  if (suffix) tokens = tokens.slice(0, tokens.length - suffix.length);
  return tokens.join("");
}

/** Mã nội bộ của một tỉnh: `vn63:dak-lak`. */
export function unitCode(set: "vn63" | "vn34", name: string): string {
  return `${set}:${words(name).join("-")}`;
}

/** Một dòng của bảng `admin_unit`. */
export interface Unit {
  code: string;
  level: "macro_region" | "region" | "province";
  set?: "vn63" | "vn34";
  vi: string;
  en: string;
  parent?: string;
  successor?: string;
  /** Các cách viết khác của tên, để khớp với tên trong file đường biên. */
  variants: string[];
}

function rows(tsv: string): Record<string, string>[] {
  const [header, ...lines] = tsv.split(/\r?\n/).filter((line) => line.trim() !== "");
  const names = header.split("\t");
  return lines.map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(names.map((name, index) => [name, (cells[index] ?? "").trim()]));
  });
}

const list = (cell: string) =>
  cell
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item !== "");

/** Đọc `regions.tsv` và `provinces_vn63.tsv` thành các đơn vị, như `load_seed_data` của backend. */
export function readUnits(provincesTsv: string, regionsTsv: string): Unit[] {
  const units: Unit[] = [];
  for (const row of rows(regionsTsv)) {
    units.push({
      code: row.code,
      level: row.level as Unit["level"],
      vi: row.name_vi,
      en: row.name_en,
      ...(row.parent ? { parent: row.parent } : {}),
      variants: list(row.aliases),
    });
  }
  const successors = new Map<string, string>();
  for (const row of rows(provincesTsv)) {
    const successor = unitCode("vn34", row.successor);
    successors.set(successor, row.successor);
    units.push({
      code: unitCode("vn63", row.name_vi),
      level: "province",
      set: "vn63",
      vi: row.name_vi,
      en: stripDiacritics(row.name_vi),
      parent: row.region,
      successor,
      variants: list(row.variants),
    });
  }
  for (const [code, name] of successors) {
    units.push({ code, level: "province", set: "vn34", vi: name, en: stripDiacritics(name), variants: [] });
  }
  return units;
}

// Hình học. Toạ độ là [kinh độ, vĩ độ] trước khi chiếu, [x, y] của khung vẽ sau khi chiếu.

export type Point = [number, number];
/** Một vòng khép kín: điểm cuối trùng điểm đầu. */
export type Ring = Point[];

export type Geometry =
  { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };

/** Mọi vòng (vòng ngoài và lỗ) của một hình GeoJSON. */
export function ringsOf(geometry: Geometry): Ring[] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flat() as Ring[];
}

/** Diện tích có dấu của một vòng: dương khi đi ngược chiều kim đồng hồ trong hệ trục có y hướng lên. */
export function signedArea(ring: Ring): number {
  let twice = 0;
  for (let k = 0; k + 1 < ring.length; k++) twice += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
  return twice / 2;
}

const keyOf = (point: Point) => `${point[0]},${point[1]}`;

/**
 * Gộp các hình kề nhau thành hình bao của chúng. Hai hình kề nhau đi qua đường biên chung theo hai chiều ngược
 * nhau, nên cạnh nào có cạnh ngược chiều thì là cạnh trong và bị bỏ; các cạnh còn lại nối thành vòng.
 * Chỉ đúng khi đường biên chung trùng nhau từng đỉnh, như trong hai file nguồn.
 */
export function dissolve(rings: Ring[]): Ring[] {
  const edges = new Map<string, [Point, Point]>();
  for (const ring of rings) {
    for (let k = 0; k + 1 < ring.length; k++) {
      const key = `${keyOf(ring[k])}>${keyOf(ring[k + 1])}`;
      if (edges.has(key)) throw new Error(`Shapes overlap: the edge ${key} belongs to two of them`);
      edges.set(key, [ring[k], ring[k + 1]]);
    }
  }
  for (const [key, [from, to]] of [...edges]) {
    const twin = `${keyOf(to)}>${keyOf(from)}`;
    if (edges.has(key) && edges.has(twin)) {
      edges.delete(key);
      edges.delete(twin);
    }
  }

  // Từ mỗi đỉnh: các cạnh còn lại đi ra khỏi nó.
  const leaving = new Map<string, Point[]>();
  for (const [from, to] of edges.values()) {
    const targets = leaving.get(keyOf(from));
    if (targets) targets.push(to);
    else leaving.set(keyOf(from), [to]);
  }
  const merged: Ring[] = [];
  for (const [from] of edges.values()) {
    const start = keyOf(from);
    if (!leaving.has(start)) continue;
    const ring: Ring = [from];
    let at = start;
    do {
      const targets = leaving.get(at);
      if (!targets) throw new Error(`The outline does not close at ${at}`);
      const to = targets.pop()!;
      if (targets.length === 0) leaving.delete(at);
      ring.push(to);
      at = keyOf(to);
    } while (at !== start);
    merged.push(ring);
  }
  return merged;
}

export interface Bounds {
  west: number;
  east: number;
  south: number;
  north: number;
  /** Vĩ độ mà ở đó hình giữ đúng tỉ lệ ngang dọc. */
  middle: number;
}

/**
 * Phép chiếu của bản đồ: kinh độ và vĩ độ tỉ lệ đều, kinh độ co lại theo cos của vĩ độ giữa. Góc tây bắc là (0, 0),
 * mép đông ở x = `width`, y tăng về phía nam như trong SVG.
 */
export function projector(bounds: Bounds, width: number): { project(point: Point): Point; height: number } {
  const squeeze = Math.cos((bounds.middle * Math.PI) / 180);
  const scale = width / ((bounds.east - bounds.west) * squeeze);
  return {
    project: ([lon, lat]) => [(lon - bounds.west) * squeeze * scale, (bounds.north - lat) * scale],
    height: (bounds.north - bounds.south) * scale,
  };
}

/** Tích có hướng của AB và AC: bằng 0 khi ba điểm thẳng hàng. */
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/**
 * Đưa các vòng về lưới số nguyên của khung vẽ: chiếu, làm tròn, rồi bỏ những đỉnh không còn làm đổi hình (đỉnh
 * trùng nhau, đỉnh nằm giữa một đoạn thẳng, gai đi ra rồi quay lại). Vòng nào xẹp mất thì trả về vị trí của nó
 * như một chấm.
 */
export function toGrid(rings: Ring[], project: (point: Point) => Point): { rings: Ring[]; specks: Point[] } {
  const kept: Ring[] = [];
  const specks = new Map<string, Point>();
  for (const ring of rings) {
    const projected = ring.slice(0, -1).map(project);
    // Cộng 0 để -0 (kết quả làm tròn của -0,3) thành 0.
    let points = projected.map(([x, y]): Point => [Math.round(x) + 0, Math.round(y) + 0]);
    for (let changed = true; changed && points.length > 0;) {
      changed = false;
      const next: Point[] = [];
      for (let k = 0; k < points.length; k++) {
        const before = next.length > 0 ? next[next.length - 1] : points[points.length - 1];
        const after = points[(k + 1) % points.length];
        if (cross(before, points[k], after) === 0) changed = true;
        else next.push(points[k]);
      }
      points = next;
    }
    if (points.length >= 3) {
      // Bắt đầu ở đỉnh có x nhỏ nhất, rồi y nhỏ nhất: kết quả không phụ thuộc đỉnh mà vòng nguồn bắt đầu.
      let first = 0;
      for (let k = 1; k < points.length; k++) {
        const [x, y] = points[k];
        if (x < points[first][0] || (x === points[first][0] && y < points[first][1])) first = k;
      }
      points = [...points.slice(first), ...points.slice(0, first)];
      kept.push([...points, points[0]]);
    } else if (projected.length > 0) {
      const mean = (axis: 0 | 1) =>
        Math.round(projected.reduce((sum, point) => sum + point[axis], 0) / projected.length);
      const speck: Point = [mean(0), mean(1)];
      specks.set(keyOf(speck), speck);
    }
  }
  return { rings: kept, specks: [...specks.values()] };
}

/**
 * Rút gọn một hình chi tiết bằng cách ghim mọi đỉnh vào lưới `step` độ. Đường biên chung của hai hình kề nhau vẫn
 * trùng nhau, vì cùng một đỉnh luôn được ghim về cùng một chỗ. Đa giác xẹp mất thì bị bỏ; nếu nó thuộc một trong
 * hai quần đảo, vị trí của nó được giữ lại trong `islets`.
 */
export function snapGeometry(geometry: Geometry, step: number): { geometry: Geometry | null; islets: Point[] } {
  const digits = Math.max(0, Math.ceil(-Math.log10(step)));
  const onGrid = ([lon, lat]: Point): Point => [lon / step, lat / step];
  // Viết lại bằng số thập phân ngắn: 10485 × 0,01 trong số thực nhị phân là 104,85000000000001.
  const degrees = ([x, y]: Point): Point => [Number((x * step).toFixed(digits)), Number((y * step).toFixed(digits))];
  const polygons = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates) as Ring[][];
  const kept: Ring[][] = [];
  const islets = new Map<string, Point>();
  for (const [outer, ...holes] of polygons) {
    const shell = toGrid([outer], onGrid);
    if (shell.rings.length === 0) {
      if (archipelagoOf(outer[0]) >= 0) {
        for (const speck of shell.specks) islets.set(keyOf(speck), degrees(speck));
      }
      continue;
    }
    kept.push([...shell.rings, ...toGrid(holes, onGrid).rings].map((ring) => ring.map(degrees)));
  }
  return {
    geometry: kept.length > 0 ? { type: "MultiPolygon", coordinates: kept } : null,
    islets: [...islets.values()],
  };
}

/** Thuộc tính `d` của `<path>`: mỗi vòng một đường con, toạ độ nguyên, các bước tương đối. */
export function pathOf(rings: Ring[]): string {
  return rings
    .map((ring) => {
      const steps = [];
      for (let k = 1; k + 1 < ring.length; k++)
        steps.push(`${ring[k][0] - ring[k - 1][0]} ${ring[k][1] - ring[k - 1][1]}`);
      return `M${ring[0][0]} ${ring[0][1]}l${steps.join(" ")}z`;
    })
    .join("");
}

/** Đường vẽ của các chấm: mỗi điểm là một đoạn dài bằng 0, nét có đầu tròn sẽ vẽ nó thành một chấm. */
export function dotsOf(points: Point[]): string {
  return points.map(([x, y]) => `M${x} ${y}h0`).join("");
}

/** Một điểm nằm trong vòng lớn nhất: khối tâm của nó, hoặc giữa đoạn rộng nhất ở ngang khối tâm khi khối tâm rơi ra ngoài. */
export function interiorPoint(rings: Ring[]): Point {
  const ring = rings.reduce((largest, other) =>
    Math.abs(signedArea(other)) > Math.abs(signedArea(largest)) ? other : largest,
  );
  let [sumX, sumY, twice] = [0, 0, 0];
  for (let k = 0; k + 1 < ring.length; k++) {
    const weight = ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
    sumX += (ring[k][0] + ring[k + 1][0]) * weight;
    sumY += (ring[k][1] + ring[k + 1][1]) * weight;
    twice += weight;
  }
  const [x, y] = [sumX / (3 * twice), sumY / (3 * twice)];

  // Các chỗ đường ngang qua khối tâm cắt vòng; giữa hai chỗ cắt liên tiếp (chẵn, lẻ) là phần nằm trong vòng.
  const crossings: number[] = [];
  for (let k = 0; k + 1 < ring.length; k++) {
    const [x1, y1] = ring[k];
    const [x2, y2] = ring[k + 1];
    if (y1 > y !== y2 > y) crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  crossings.sort((a, b) => a - b);
  let best: [number, number] = [x, x];
  for (let k = 0; k + 1 < crossings.length; k += 2) {
    if (crossings[k] <= x && x <= crossings[k + 1]) return [Math.round(x), Math.round(y)];
    if (crossings[k + 1] - crossings[k] > best[1] - best[0]) best = [crossings[k], crossings[k + 1]];
  }
  return [Math.round((best[0] + best[1]) / 2), Math.round(y)];
}

// Lắp ráp bốn lớp của bản đồ.

/** Khung của bản đồ: đất liền, vùng biển và hai quần đảo. */
export const BOUNDS: Bounds = { west: 102.0, east: 117.6, south: 6.6, north: 23.6, middle: 16 };
/** Bề ngang của khung vẽ, tính bằng đơn vị của SVG; một đơn vị là khoảng 1,6 km. */
export const WIDTH = 1000;

/** Hai quần đảo có đảo quá nhỏ để còn hình ở tỉ lệ này: mỗi đảo được giữ lại như một chấm, và quần đảo có nhãn. */
export const ARCHIPELAGOS = [
  { vi: "Quần đảo Hoàng Sa", en: "Hoàng Sa Islands", west: 110.8, east: 113.2, south: 15.4, north: 17.4 },
  { vi: "Quần đảo Trường Sa", en: "Trường Sa Islands", west: 111.0, east: 117.6, south: 6.6, north: 12.2 },
];

/** Hình có tên riêng trong file 63 tỉnh nhưng không phải một tỉnh: Côn Đảo là một huyện của Bà Rịa - Vũng Tàu. */
const PARTS: Record<string, string> = { condao: "Bà Rịa - Vũng Tàu" };

export interface Feature {
  properties: Record<string, unknown>;
  geometry: Geometry;
}

export interface FeatureCollection {
  features: Feature[];
}

export interface Sources {
  provincesTsv: string;
  regionsTsv: string;
  /** 63 tỉnh: GeoJSON của geoBoundaries, tên tỉnh ở thuộc tính `shapeName`. */
  provinces63: FeatureCollection;
  /** 34 đơn vị: GeoJSON của HDX sau `scripts/snap-hdx.mjs`, với các thuộc tính `name_vi`, `pcode`, `islets`. */
  provinces34: FeatureCollection;
}

/** Quần đảo chứa một điểm (chỉ số trong `ARCHIPELAGOS`), hoặc -1. */
export function archipelagoOf([lon, lat]: Point): number {
  return ARCHIPELAGOS.findIndex((box) => lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north);
}

/** Các vòng của từng tỉnh bộ 63, theo mã: mỗi hình của file nguồn thuộc tỉnh mang tên đó. */
export function rings63Of(units: Unit[], collection: FeatureCollection): Map<string, Ring[]> {
  const old = units.filter((unit) => unit.set === "vn63");
  const named = new Map<string, Unit>();
  for (const unit of old) {
    for (const name of [unit.vi, ...unit.variants]) {
      const known = named.get(placeKey(name));
      if (known && known !== unit) throw new Error(`"${name}" names both ${known.code} and ${unit.code}`);
      named.set(placeKey(name), unit);
    }
  }
  const rings = new Map<string, Ring[]>();
  for (const feature of collection.features) {
    const name = String(feature.properties.shapeName).trim();
    const unit = named.get(placeKey(PARTS[placeKey(name)] ?? name));
    if (!unit) throw new Error(`No province of the 63 is called "${name}"`);
    rings.set(unit.code, [...(rings.get(unit.code) ?? []), ...ringsOf(feature.geometry)]);
  }
  for (const unit of old) {
    if (!rings.has(unit.code)) throw new Error(`No shape for ${unit.code} (${unit.vi})`);
  }
  return rings;
}

/** Hình của từng đơn vị bộ 34 trong file riêng của chúng, theo mã. */
export function features34Of(units: Unit[], collection: FeatureCollection): Map<string, Feature> {
  const current = units.filter((unit) => unit.set === "vn34");
  const features = new Map<string, Feature>();
  for (const feature of collection.features) {
    const name = String(feature.properties.name_vi);
    const unit = current.find((candidate) => placeKey(candidate.vi) === placeKey(name));
    if (!unit) throw new Error(`No unit of the 34 is called "${name}"`);
    features.set(unit.code, feature);
  }
  for (const unit of current) {
    if (!features.has(unit.code)) throw new Error(`No shape for ${unit.code} (${unit.vi})`);
  }
  return features;
}

export function generate(sources: Sources): MapData {
  const { project, height } = projector(BOUNDS, WIDTH);
  const units = readUnits(sources.provincesTsv, sources.regionsTsv);
  const old = units.filter((unit) => unit.set === "vn63");
  const current = units.filter((unit) => unit.set === "vn34");

  const rings63 = rings63Of(units, sources.provinces63);
  /** Hình gộp của các tỉnh bộ 63 thoả một điều kiện. */
  const merged = (belongs: (unit: Unit) => boolean) =>
    dissolve(old.filter(belongs).flatMap((unit) => rings63.get(unit.code)!));
  const features34 = features34Of(units, sources.provinces34);
  const isletsOf = (feature: Feature) => (feature.properties.islets as Point[] | undefined) ?? [];

  /** Tâm các đảo của từng quần đảo trong một file nguồn: vòng nằm trong khung của quần đảo, và các điểm đảo kèm theo. */
  const islandsIn = (rings: Ring[], islets: Point[]): Point[][] =>
    ARCHIPELAGOS.map((_, index) => [
      ...rings
        .filter((ring) => archipelagoOf(ring[0]) === index)
        .map((ring): Point => {
          const corners = ring.slice(0, -1);
          const mean = (axis: 0 | 1) => corners.reduce((sum, point) => sum + point[axis], 0) / corners.length;
          return [mean(0), mean(1)];
        }),
      ...islets.filter((islet) => archipelagoOf(islet) === index),
    ]);
  // Hai file nguồn vẽ hai quần đảo chi tiết rất khác nhau. Mọi lớp dùng chung một bộ đảo, lấy từ file có nhiều đảo
  // hơn, để hình các quần đảo không đổi khi người xem đổi cấp.
  const in63 = islandsIn([...rings63.values()].flat(), []);
  const in34 = islandsIn(
    [...features34.values()].flatMap((feature) => ringsOf(feature.geometry)),
    [...features34.values()].flatMap(isletsOf),
  );
  const islands = ARCHIPELAGOS.map((_, index) =>
    (in63[index].length > in34[index].length ? in63[index] : in34[index]).map(project),
  );
  const dotsOfArchipelago = islands.map((points) => {
    const dots = new Map<string, Point>();
    for (const [x, y] of points) {
      const dot: Point = [Math.round(x), Math.round(y)];
      dots.set(keyOf(dot), dot);
    }
    return [...dots.values()];
  });

  /**
   * Hình của một địa bàn trên lưới của khung vẽ. Đảo của Hoàng Sa và Trường Sa không được vẽ thành hình: ở tỉ lệ
   * này đảo lớn nhất cũng chỉ vài pixel, nên địa bàn có đảo ở quần đảo nào thì nhận các chấm của quần đảo đó.
   * Đảo nhỏ ở nơi khác xẹp mất thì bị bỏ.
   */
  function shape(rings: Ring[], islets: Point[]): Pick<MapArea, "d" | "at" | "dots"> {
    const near = toGrid(
      rings.filter((ring) => archipelagoOf(ring[0]) < 0),
      project,
    );
    const owned = new Set([...rings.map((ring) => ring[0]), ...islets].map(archipelagoOf));
    const dots = dotsOfArchipelago.flatMap((points, index) => (owned.has(index) ? points : []));
    return {
      d: pathOf(near.rings),
      at: interiorPoint(near.rings),
      ...(dots.length > 0 ? { dots: dotsOf(dots) } : {}),
    };
  }

  const regions = units.filter((unit) => unit.level === "region");
  const macroOf = new Map(regions.map((unit) => [unit.code, unit.parent]));
  const names = (unit: Unit) => ({ code: unit.code, vi: unit.vi, en: unit.en });
  const byCode = (a: MapArea, b: MapArea) => (a.code < b.code ? -1 : 1);
  const levels: Record<MapLevel, MapArea[]> = {
    macro: units
      .filter((unit) => unit.level === "macro_region")
      .map((unit) => {
        const rings = merged((province) => macroOf.get(province.parent!) === unit.code);
        return { ...names(unit), ...shape(rings, []) };
      })
      .sort(byCode),
    region: regions
      .map((unit) => {
        const rings = merged((province) => province.parent === unit.code);
        return { ...names(unit), parent: unit.parent, ...shape(rings, []) };
      })
      .sort(byCode),
    vn63: old
      .map((unit) => ({
        ...names(unit),
        parent: unit.parent,
        successor: unit.successor,
        ...shape(rings63.get(unit.code)!, []),
      }))
      .sort(byCode),
    vn34: current
      .map((unit) => {
        const feature = features34.get(unit.code)!;
        return {
          ...names(unit),
          pcode: String(feature.properties.pcode),
          ...shape(ringsOf(feature.geometry), isletsOf(feature)),
        };
      })
      .sort(byCode),
  };

  // Nhãn của mỗi quần đảo neo ở mép bắc của các đảo, giữa theo chiều ngang: chữ nằm phía trên, không đè lên chấm.
  const labels: MapLabel[] = [];
  ARCHIPELAGOS.forEach(({ vi, en }, index) => {
    const dots = dotsOfArchipelago[index];
    if (dots.length === 0) return;
    const middle = Math.round(dots.reduce((sum, dot) => sum + dot[0], 0) / dots.length);
    labels.push({ vi, en, at: [middle, Math.min(...dots.map((dot) => dot[1]))] });
  });

  return {
    width: WIDTH,
    height: Math.round(height),
    levels,
    labels,
    sources: [
      {
        levels: ["vn34"],
        name: "Viet Nam - Subnational Administrative Boundaries (COD-AB), OCHA; nguồn: Tổng cục Thống kê",
        license: "CC BY-IGO",
        url: "https://data.humdata.org/dataset/cod-ab-vnm",
      },
      {
        levels: ["vn63", "region", "macro"],
        name: "geoBoundaries gbOpen VNM ADM1 (William & Mary geoLab)",
        license: "Public Domain",
        url: "https://www.geoboundaries.org",
      },
    ],
  };
}

/** Nội dung của file `vn-map.json`: JSON, mỗi địa bàn một dòng để diff của git đọc được. */
export function serialize(map: MapData): string {
  const levels = (Object.keys(map.levels) as MapLevel[]).map(
    (level) => `${JSON.stringify(level)}:[\n${map.levels[level].map((area) => JSON.stringify(area)).join(",\n")}\n]`,
  );
  return [
    `{"width":${map.width},"height":${map.height},"levels":{`,
    levels.join(",\n"),
    `},"labels":${JSON.stringify(map.labels)},`,
    `"sources":${JSON.stringify(map.sources)}}`,
    "",
  ].join("\n");
}
