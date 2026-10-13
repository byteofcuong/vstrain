// Tạo và xoá tài khoản tạm cho test đầu-cuối, trên stack đang chạy (`docker compose ... up -d`).
// Tài khoản được tạo bằng chính lệnh quản trị `create-user`, vì hệ thống không có tự đăng ký. Mật khẩu là chuỗi
// ngẫu nhiên, chỉ tồn tại trong tiến trình test. File này là JavaScript thuần vì nó dùng API của Node, mà phần
// TypeScript của dự án không cài khai báo kiểu cho Node; kiểu của nó nằm ở `accounts.d.mts`.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const COMPOSE = ["compose", "-f", fileURLToPath(new URL("../../deploy/docker-compose.yml", import.meta.url))];

function docker(args, input) {
  const run = spawnSync("docker", [...COMPOSE, ...args], { encoding: "utf8", input });
  if (run.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${run.stderr || run.stdout}`);
  return run.stdout.trim();
}

function sql(text) {
  return docker(["exec", "-T", "db", "psql", "-U", "vietstrain", "-d", "vietstrain", "-At", "-c", text]);
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

/** Xoá một tài khoản tạm cùng phiên và các dòng nhật ký của nó. Email do `createAccount` sinh ra, chỉ gồm chữ và số. */
export function removeAccount(email) {
  if (!/^e2e-[0-9a-f]{12}@example\.org$/.test(email)) throw new Error(`Not a temporary account: ${email}`);
  const id = sql(`SELECT id FROM app_user WHERE email = '${email}'`);
  if (id === "") return;
  sql(`DELETE FROM audit_log WHERE actor_id = ${Number(id)} OR subject = 'user:${Number(id)}'`);
  sql(`DELETE FROM app_user WHERE id = ${Number(id)}`);
}
