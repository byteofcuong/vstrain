// Dựng file hình học của bản đồ, `src/map/vn-map.json`, từ hai file đường biên trong `map-data/` và các file seed
// địa danh của backend. Chạy lại mỗi khi một trong các file đó đổi; test `vn-map.test.ts` sẽ báo nếu quên.
//
// Chạy trong frontend/ bằng Node 24:  npm run build:map
import { readFileSync, writeFileSync } from "node:fs";

import { generate, serialize } from "../src/map/generate.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const map = generate({
  provincesTsv: read("../../backend/app/geo/data/provinces_vn63.tsv"),
  regionsTsv: read("../../backend/app/geo/data/regions.tsv"),
  provinces63: JSON.parse(read("../map-data/geoBoundaries-VNM-ADM1_simplified.geojson")),
  provinces34: JSON.parse(read("../map-data/hdx-vnm-adm1-snapped.geojson")),
});
const text = serialize(map);
writeFileSync(new URL("../src/map/vn-map.json", import.meta.url), text);

const sizes = Object.entries(map.levels).map(([level, areas]) => `${level}: ${areas.length}`);
process.stdout.write(`${sizes.join(", ")}; ${text.length} ký tự; khung ${map.width} × ${map.height}\n`);
