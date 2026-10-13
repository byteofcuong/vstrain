// Dữ liệu tạm cho test đầu-cuối của các trang quản trị, tạo thẳng trong database của stack đang chạy và xoá khi xong.
// Mọi chuỗi đưa vào SQL ở đây đều do file này sinh ra (chữ thường và số), không có chuỗi nào từ bên ngoài.
import { randomBytes } from "node:crypto";

import { processesOf, sql } from "./accounts.mjs";

const TAG = /^[0-9a-f]{8}$/;

function checked(tag) {
  if (!TAG.test(tag)) throw new Error(`Not a tag made by these tests: ${tag}`);
  return tag;
}

/**
 * Một dataset tạm không chọn được mẫu nào (trần số mẫu là 0). Dựng nó thì job hỏng ngay ở bước chọn mẫu, nên test
 * có một job hỏng thật để xem và chạy lại mà không phải dựng một cây thật (vài phút) hay đụng tới dataset thật.
 */
export function createEmptyDataset() {
  const tag = randomBytes(4).toString("hex");
  const dataset = { tag, slug: `e2e-${tag}`, title: `Bộ thử ${tag}` };
  sql(
    `INSERT INTO dataset_def (slug, title, pathogen, lineage, max_samples)
     VALUES ('${dataset.slug}', '${dataset.title}', 'dengue', 'denv1', 0)`,
  );
  return dataset;
}

/**
 * Một dataset tạm chọn được vài trăm mẫu DENV1 thật. Dựng nó thì worker chạy công cụ thật trong vài phút: đủ lâu để
 * huỷ giữa chừng, đủ nhỏ để không chiếm máy. Nó không bao giờ được dựng tới cùng trong test.
 */
export function createSmallDataset() {
  const tag = randomBytes(4).toString("hex");
  const dataset = { tag, slug: `e2e-${tag}`, title: `Bộ nhỏ ${tag}` };
  sql(
    `INSERT INTO dataset_def (slug, title, pathogen, lineage, max_samples)
     VALUES ('${dataset.slug}', '${dataset.title}', 'dengue', 'denv1', 400)`,
  );
  return dataset;
}

/** Worker chung có đang chạy công cụ dựng cây nào không (Augur, IQ-TREE và các tiến trình con của chúng). */
export function treeToolsRunning() {
  const [, ...processes] = processesOf("worker").split("\n");
  return /\b(augur|iqtree\w*|mafft|fasttree)\b/i.test(processes.join("\n"));
}

/** Tình trạng các bước của một job, theo thứ tự chạy. */
export function stepsOf(jobId) {
  if (!Number.isInteger(jobId)) throw new Error("Unexpected job id");
  return sql(`SELECT name, status FROM job_step WHERE job_id = ${jobId} ORDER BY position`)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .map(([name, status]) => ({ name, status }));
}

/** Xoá một dataset tạm cùng các job và build của nó; trả về số dòng còn sót (phải là 0). */
export function removeDataset(dataset) {
  const slug = `e2e-${checked(dataset.tag)}`;
  sql(`DELETE FROM job WHERE params->>'dataset' = '${slug}'`);
  sql(`DELETE FROM dataset_def WHERE slug = '${slug}'`);
  sql(`DELETE FROM audit_log WHERE subject = 'dataset:${slug}'`);
  return Number(
    sql(
      `SELECT (SELECT count(*) FROM job WHERE params->>'dataset' = '${slug}')
            + (SELECT count(*) FROM dataset_def WHERE slug = '${slug}')`,
    ),
  );
}

/** Một bản ghi GenBank tạm trong nước, mang một cách viết địa danh mà không tên thay thế nào khớp. */
export function createUnresolvedSample() {
  const tag = randomBytes(4).toString("hex");
  const place = { tag, accession: `E2E${tag.toUpperCase()}`, text: `Xóm Thử ${tag}`, key: `xomthu${tag}` };
  place.internalId = sql(
    `INSERT INTO sample (display_name, pathogen, source, accession, country, division_raw, geo_status,
                         collection_date_raw, date_min, date_max)
     VALUES ('e2e/${tag}', 'dengue', 'genbank', '${place.accession}', 'Vietnam', '${place.text}', 'unresolved',
             '2019-03-15', DATE '2019-03-15', DATE '2019-03-15')
     RETURNING internal_id`,
  ).split("\n")[0];
  return place;
}

/** Tình trạng địa danh của bản ghi tạm, đọc thẳng từ database. */
export function placeOf(place) {
  const [status, unit] = sql(
    `SELECT geo_status, coalesce(admin_unit_code, '') FROM sample WHERE accession = 'E2E${checked(place.tag).toUpperCase()}'`,
  ).split("\t");
  return { status, unit: unit || null };
}

/** Các job dựng cây của dataset tạm, cũ nhất trước. */
export function buildJobs(dataset) {
  return sql(
    `SELECT id, status FROM job WHERE kind = 'build_dataset' AND params->>'dataset' = 'e2e-${checked(dataset.tag)}'
     ORDER BY id`,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .map(([id, status]) => ({ id: Number(id), status }));
}

/** Xoá mọi thứ hai hàm tạo ở trên, và các test dùng chúng, để lại; trả về số dòng còn sót (phải là 0). */
export function removeOperationsData(dataset, place) {
  const slug = `e2e-${checked(dataset.tag)}`;
  const accession = `E2E${checked(place.tag).toUpperCase()}`;
  const key = `xomthu${place.tag}`;
  sql(`DELETE FROM job WHERE params->>'dataset' = '${slug}'`);
  sql(`DELETE FROM dataset_def WHERE slug = '${slug}'`);
  sql(`DELETE FROM place_alias WHERE key = '${key}' AND source = 'admin'`);
  sql(`DELETE FROM sample WHERE accession = '${accession}'`);
  sql(`DELETE FROM audit_log WHERE subject IN ('dataset:${slug}', 'place:${key}')`);
  return Number(
    sql(
      `SELECT (SELECT count(*) FROM job WHERE params->>'dataset' = '${slug}')
            + (SELECT count(*) FROM dataset_def WHERE slug = '${slug}')
            + (SELECT count(*) FROM place_alias WHERE key = '${key}')
            + (SELECT count(*) FROM sample WHERE accession = '${accession}')`,
    ),
  );
}
