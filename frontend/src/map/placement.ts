import type { Column } from "../tree/columns";
import type { AreaFilter } from "../tree/filter";
import type { MapData, MapLevel } from "./types";

/**
 * Xếp tip vào địa bàn của bản đồ. Mỗi tip có tối đa một mã tỉnh (cột `unit`: `vn63:…` hoặc `vn34:…` tuỳ ngày lấy
 * mẫu) và một mã vùng hoặc miền (cột `region`: `vnr:…` hoặc `vnm:…`). Ở mỗi cấp, tip được xếp vào địa bàn chứa
 * nơi đã biết của nó; biết chưa đủ mịn cho cấp đó thì không xếp, không đoán.
 */

/** Tên nước nhà trong cột `country` của bản publish (tên chuẩn do bước nhập của backend đặt). */
export const HOME_COUNTRY = "Vietnam";

/** Các cấp để chọn cấp mở đầu, từ mịn tới thô. Cấp tỉnh ở đây là bộ 34, bộ đang có hiệu lực. */
const OPENING_LEVELS = ["vn34", "region", "macro"] as const;
export type OpeningLevel = (typeof OPENING_LEVELS)[number];

/**
 * Bảng tra của một cấp: mã địa bàn trong các cột → chỉ số địa bàn ở cấp đó. Mã không có trong bảng là mã không
 * xếp được ở cấp này.
 */
function lookup(map: MapData, level: MapLevel): { units: Map<string, number>; regions: Map<string, number> } {
  const indexOf = new Map(map.levels[level].map((area, index) => [area.code, index]));
  const units = new Map<string, number>();
  const regions = new Map<string, number>();
  const macroOfRegion = new Map(map.levels.region.map((area) => [area.code, area.parent]));
  /** Địa bàn ở cấp này chứa một tỉnh bộ 63. */
  const containing = (province: MapData["levels"]["vn63"][number]): string | undefined => {
    if (level === "vn63") return province.code;
    if (level === "vn34") return province.successor;
    return level === "region" ? province.parent : macroOfRegion.get(province.parent ?? "");
  };
  const set = (table: Map<string, number>, code: string, target: string | undefined) => {
    const index = target === undefined ? undefined : indexOf.get(target);
    if (index !== undefined) table.set(code, index);
  };

  for (const province of map.levels.vn63) set(units, province.code, containing(province));
  for (const unit of map.levels.vn34) {
    if (level === "vn34") {
      set(units, unit.code, unit.code);
    } else if (level !== "vn63") {
      // Đơn vị bộ 34 nằm trong một vùng (hay miền) chỉ khi mọi tỉnh gộp vào nó đều nằm trong vùng (miền) đó.
      const homes = new Set(map.levels.vn63.filter((province) => province.successor === unit.code).map(containing));
      if (homes.size === 1) set(units, unit.code, [...homes][0]);
    }
  }
  if (level === "region" || level === "macro") {
    for (const region of map.levels.region) set(regions, region.code, level === "region" ? region.code : region.parent);
  }
  if (level === "macro") {
    for (const macro of map.levels.macro) set(regions, macro.code, macro.code);
  }
  return { units, regions };
}

/**
 * Địa bàn của từng tip ở một cấp: chỉ số trong `map.levels[level]`, hoặc -1 khi không xếp được. Mã tỉnh được xét
 * trước cột vùng, để số của một vùng luôn gồm đủ số của các tỉnh trong nó.
 */
export function placeTips(map: MapData, level: MapLevel, unit: Column | null, region: Column | null): Int32Array {
  const tipCount = unit?.tipCodes.length ?? region?.tipCodes.length ?? 0;
  const { units, regions } = lookup(map, level);
  // Đổi bảng tra theo mã thành bảng tra theo chỉ số giá trị của từng cột, để vòng lặp trên tip chỉ đọc mảng số.
  const table = (column: Column | null, known: Map<string, number>) =>
    column ? Int32Array.from(column.values, (value) => known.get(value) ?? -1) : new Int32Array(0);
  const ofUnit = table(unit, units);
  const ofRegion = table(region, regions);

  const tips = new Int32Array(tipCount).fill(-1);
  for (let k = 0; k < tipCount; k++) {
    const unitCode = unit ? unit.tipCodes[k] : -1;
    if (unitCode >= 0) tips[k] = ofUnit[unitCode];
    if (tips[k] < 0) {
      const regionCode = region ? region.tipCodes[k] : -1;
      if (regionCode >= 0) tips[k] = ofRegion[regionCode];
    }
  }
  return tips;
}

/** Số tip của từng địa bàn: tất cả (`total`) và số còn hiện sau các bộ lọc (`visible`). */
export function countAreas(
  areaOfTip: Int32Array,
  areaCount: number,
  tipVisible: Uint8Array,
): { total: Int32Array; visible: Int32Array } {
  const total = new Int32Array(areaCount);
  const visible = new Int32Array(areaCount);
  for (let k = 0; k < areaOfTip.length; k++) {
    const area = areaOfTip[k];
    if (area < 0) continue;
    total[area]++;
    if (tipVisible[k]) visible[area]++;
  }
  return { total, visible };
}

/** Mặt nạ theo tip: 1 là tip của nước nhà. `null` khi dataset không có cột quốc gia. */
export function homeMask(country: Column | null, name: string): Uint8Array | null {
  if (!country) return null;
  const code = country.values.indexOf(name);
  return Uint8Array.from(country.tipCodes, (tipCode) => (code >= 0 && tipCode === code ? 1 : 0));
}

/**
 * Trong các tip đang hiện: bao nhiêu tip của nước nhà (`home`, `null` khi không biết), và bao nhiêu trong số đó
 * xếp được vào một địa bàn ở cấp đang xem (`placed`). Không biết tip nào của nước nhà thì đếm mọi tip xếp được.
 */
export function coverage(
  areaOfTip: Int32Array,
  home: Uint8Array | null,
  tipVisible: Uint8Array,
): { home: number | null; placed: number } {
  let homeCount = 0;
  let placed = 0;
  for (let k = 0; k < tipVisible.length; k++) {
    if (!tipVisible[k] || (home !== null && !home[k])) continue;
    homeCount++;
    if (k < areaOfTip.length && areaOfTip[k] >= 0) placed++;
  }
  return { home: home === null ? null : homeCount, placed };
}

/** Mặt nạ theo tip: 1 là tip được xếp vào một trong các địa bàn đã chọn (chỉ số địa bàn). */
export function areaMask(areaOfTip: Int32Array, selected: readonly number[]): Uint8Array {
  const chosen = new Set(selected);
  return Uint8Array.from(areaOfTip, (area) => (chosen.has(area) ? 1 : 0));
}

/** Mặt nạ của bộ lọc theo địa bàn: 1 là tip được xếp vào một trong các địa bàn đã chọn, ở cấp của bộ lọc. */
export function selectionMask(map: MapData, area: AreaFilter, unit: Column | null, region: Column | null): Uint8Array {
  const selected = area.codes.map((code) => map.levels[area.level].findIndex((candidate) => candidate.code === code));
  return areaMask(
    placeTips(map, area.level, unit, region),
    selected.filter((index) => index >= 0),
  );
}

/**
 * Cấp mà bản đồ mở đầu: cấp mịn nhất xếp được ít nhất một nửa số tip của nước nhà; không cấp nào đạt thì lấy cấp
 * xếp được nhiều nhất (bằng nhau thì lấy cấp mịn hơn). Không biết số tip của nước nhà thì so với cấp xếp được
 * nhiều nhất.
 */
export function defaultLevel(placed: Record<OpeningLevel, number>, home: number | null): OpeningLevel {
  const most = Math.max(...OPENING_LEVELS.map((level) => placed[level]));
  const whole = home ?? most;
  const enough = OPENING_LEVELS.find((level) => whole > 0 && placed[level] * 2 >= whole);
  return enough ?? OPENING_LEVELS.find((level) => placed[level] === most)!;
}
