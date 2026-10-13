// Tạo và xoá tài khoản tạm cho test đầu-cuối, trên stack đang chạy (`docker compose ... up -d`).
// Tài khoản được tạo bằng chính lệnh quản trị `create-user`, vì hệ thống không có tự đăng ký. Mật khẩu là chuỗi
// ngẫu nhiên, chỉ tồn tại trong tiến trình test. File này là JavaScript thuần vì nó dùng API của Node, mà phần
// TypeScript của dự án không cài khai báo kiểu cho Node; kiểu của nó nằm ở `accounts.d.mts`.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const COMPOSE = ["compose", "-f", fileURLToPath(new URL("../../deploy/docker-compose.yml", import.meta.url))];

function docker(args, input) {
  const run = spawnSync("docker", [...COMPOSE, ...args], { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`docker ${args.slice(0, 6).join(" ")} failed: ${run.stderr || run.stdout}`);
  return run.stdout.trim();
}

/** Email cho một tài khoản tạm do chính test tạo qua giao diện; `removeAccount` nhận ra và xoá được nó. */
export function temporaryEmail() {
  return `e2e-${randomBytes(6).toString("hex")}@example.org`;
}

/** Một mật khẩu ngẫu nhiên có dấu tiếng Việt, bắt đầu bằng `words` để các mật khẩu của một test dễ phân biệt. */
export function temporaryPassword(words) {
  return `${words} ${randomBytes(9).toString("base64url")}`;
}

/** Chạy một câu SQL trên database của stack; chỉ dùng với chuỗi do chính các file test này dựng. */
export function sql(text) {
  return docker(["exec", "-T", "db", "psql", "-U", "vietstrain", "-d", "vietstrain", "-At", "-F", "\t", "-c", text]);
}

/** Tạo một tài khoản tạm và trả về thông tin để đăng nhập. */
export function createAccount(role = "submitter") {
  const tag = randomBytes(6).toString("hex");
  const account = {
    email: `e2e-${tag}@example.org`,
    displayName: `Người thử ${tag}`,
    // Có dấu tiếng Việt, để đường đi của mật khẩu có dấu cũng được thử.
    password: `mật khẩu ${randomBytes(12).toString("base64url")}`,
    role,
  };
  docker(
    ["exec", "-T", "api", "python", "-m", "app.cli", "create-user"].concat([
      "--email",
      account.email,
      "--name",
      account.displayName,
      "--role",
      role,
      "--password-stdin",
    ]),
    account.password + "\n",
  );
  return account;
}

/**
 * Xoá một tài khoản tạm cùng mọi thứ nó để lại: phiên, mẫu đã nộp (kéo theo chuỗi, kết quả gióng, chỗ đặt tạm),
 * job kiểm tra của các mẫu đó, và các dòng nhật ký. Email do `createAccount` sinh ra, chỉ gồm chữ và số.
 */
export function removeAccount(email) {
  if (!/^e2e-[0-9a-f]{12}@example\.org$/.test(email)) throw new Error(`Not a temporary account: ${email}`);
  const id = Number(sql(`SELECT id FROM app_user WHERE email = '${email}'`) || NaN);
  if (!Number.isInteger(id)) return;
  const samples = `SELECT sample_id FROM submission WHERE submitter_id = ${id}`;
  // Thứ tự: nhật ký và job được tìm qua lần nộp, nên xoá trước khi xoá mẫu (lần nộp bị xoá theo mẫu).
  sql(
    `DELETE FROM audit_log WHERE actor_id = ${id} OR subject = 'user:${id}'
        OR subject IN (SELECT 'sample:' || internal_id FROM sample WHERE id IN (${samples}))`,
  );
  sql(`DELETE FROM job WHERE id IN (SELECT job_id FROM submission WHERE submitter_id = ${id})`);
  sql(`DELETE FROM sample WHERE id IN (${samples})`);
  sql(`DELETE FROM app_user WHERE id = ${id}`);
}

/**
 * Vài genome thật để nộp thử: bản ghi GenBank đủ điều kiện vào cây của dataset nhưng không nằm trong build hiện
 * hành, mỗi genome kèm ngày lấy mẫu của nó. Thứ tự cố định, để mỗi lần chạy dùng cùng dữ liệu.
 */
export function genomesOutsideBuild(slug, count) {
  if (!/^[a-z0-9-]+$/.test(slug) || !Number.isInteger(count)) throw new Error("Unexpected arguments");
  const rows = sql(
    `SELECT s.date_min, q.sequence FROM sample s
       JOIN sample_alignment a ON a.sample_id = s.id JOIN sample_sequence q ON q.sample_id = s.id
       JOIN dataset_def d ON d.slug = '${slug}' AND d.lineage = a.lineage
       JOIN build b ON b.dataset_id = d.id AND b.is_current
      WHERE s.source = 'genbank' AND a.status = 'aligned' AND a.valid_nt >= 10000
        AND s.date_min = s.date_max AND s.date_min < DATE '2025-01-01'
        AND s.id NOT IN (SELECT sample_id FROM build_sample WHERE build_id = b.id)
      ORDER BY md5(s.internal_id) LIMIT ${count}`,
  );
  const genomes = rows
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .map(([date, sequence]) => ({ date, sequence }));
  if (genomes.length < count) throw new Error(`Only ${genomes.length} genomes outside the current build of ${slug}`);
  return genomes;
}

/** Một file FASTA trong bộ nhớ, ở dạng mà `setInputFiles` của Playwright nhận. */
export function fastaFile(name, text) {
  return { name, mimeType: "text/plain", buffer: Buffer.from(text, "utf8") };
}

/** Số tip tạm và số mẫu nộp đang có trong database, để một test biết nó đã dọn sạch. */
export function submissionCounts() {
  const [submissions, placements] = sql(
    "SELECT (SELECT count(*) FROM submission), (SELECT count(*) FROM sample_placement)",
  )
    .split("\t")
    .map(Number);
  return { submissions, placements };
}
