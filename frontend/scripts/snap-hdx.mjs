// Rút gọn lớp tỉnh của HDX COD-AB (48 MB, 1,3 triệu đỉnh) thành file nguồn nhỏ lưu trong repo:
// `map-data/hdx-vnm-adm1-snapped.geojson`. File gốc không nằm trong repo; nơi tải và mã băm ghi ở `map-data/NGUON.md`.
//
// Chạy trong frontend/ bằng Node 24 (Git Bash):
//   node scripts/snap-hdx.mjs <đường dẫn tới vnm_admin1.geojson>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { snapGeometry } from "../src/map/generate.ts";

/** Bước lưới, tính bằng độ: 0,01 độ là khoảng 1,1 km, mịn hơn một đơn vị của khung vẽ (1,6 km). */
const STEP = 0.01;

const [input] = process.argv.slice(2);
if (!input) {
  process.stderr.write("Thiếu đường dẫn tới vnm_admin1.geojson\n");
  process.exit(2);
}
const raw = readFileSync(input);
const collection = JSON.parse(raw.toString("utf8"));

let before = 0;
let after = 0;
const count = (geometry) =>
  (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates)
    .flat()
    .reduce((sum, ring) => sum + ring.length, 0);
const features = collection.features.map((feature) => {
  const { geometry, islets } = snapGeometry(feature.geometry, STEP);
  if (geometry === null) throw new Error(`${feature.properties.adm1_name1} không còn hình nào sau khi rút gọn`);
  before += count(feature.geometry);
  after += count(geometry);
  const source = feature.properties;
  return {
    type: "Feature",
    properties: {
      pcode: source.adm1_pcode,
      name_vi: source.adm1_name1,
      name_en: source.adm1_name,
      type_vi: source.adm1_type_vi,
      area_sqkm: source.area_sqkm,
      ...(islets.length > 0 ? { islets } : {}),
    },
    geometry,
  };
});

const source = {
  title: "Viet Nam - Subnational Administrative Boundaries (COD-AB), version 02, admin level 1",
  publisher: "OCHA Field Information Services Section (FISS), contributed by OCHA ROAP",
  origin: "General Statistics Office of Vietnam (GSO)",
  license: "Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)",
  url: "https://data.humdata.org/dataset/cod-ab-vnm",
  file: "vnm_admin1.geojson",
  sha256: createHash("sha256").update(raw).digest("hex"),
  changes:
    `Vertices moved to a ${STEP} degree grid. Polygons that collapse on that grid are dropped; those of the ` +
    "Hoàng Sa and Trường Sa archipelagos are kept as points in the property `islets`. Properties reduced to " +
    "code, names, type and area.",
};
// Mỗi đơn vị một dòng, để diff của git đọc được.
const lines = [
  `{"type":"FeatureCollection","source":${JSON.stringify(source)},"features":[`,
  features.map((feature) => JSON.stringify(feature)).join(",\n"),
  "]}",
];
const output = new URL("../map-data/hdx-vnm-adm1-snapped.geojson", import.meta.url);
writeFileSync(output, lines.join("\n") + "\n");
process.stdout.write(`${features.length} đơn vị; ${before} đỉnh → ${after} đỉnh; ghi ${output.pathname}\n`);
