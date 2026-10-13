export type Route =
  | { page: "list" }
  /** `tip` là mã nội bộ của một tip tạm cần chỉ ra ngay khi cây mở (đi từ trang "Mẫu của tôi"). */
  | { page: "dataset"; slug: string; tip: string | null }
  | { page: "login" }
  | { page: "submit" }
  | { page: "mine" }
  /** Form sửa một mẫu mình đã nộp. */
  | { page: "editSample"; internalId: string }
  /** Tài khoản của người đang đăng nhập: đổi mật khẩu. */
  | { page: "account" }
  /** Ba trang quản trị. Địa chỉ ai cũng gõ được; quyền được kiểm ở API, trang chỉ báo khi không có quyền. */
  | { page: "admin"; section: AdminSection };

export type AdminSection = "jobs" | "datasets" | "places" | "users";

const PAGES: Record<string, Route> = {
  "#/login": { page: "login" },
  "#/submit": { page: "submit" },
  "#/mine": { page: "mine" },
  "#/account": { page: "account" },
  "#/admin/jobs": { page: "admin", section: "jobs" },
  "#/admin/datasets": { page: "admin", section: "datasets" },
  "#/admin/places": { page: "admin", section: "places" },
  "#/admin/users": { page: "admin", section: "users" },
};

/**
 * Đường dẫn trong phần `#` của URL: `#/` là danh sách, `#/d/<slug>` là một dataset (thêm `/t/<mã mẫu>` để chỉ vào
 * một tip tạm), `#/login` là trang đăng nhập, `#/submit` là form nộp mẫu, `#/mine` là các mẫu đã nộp,
 * `#/mine/<mã mẫu>/edit` là form sửa một mẫu,
 * `#/account` là tài khoản của mình, `#/admin/jobs`, `#/admin/datasets`, `#/admin/places` và `#/admin/users` là
 * các trang quản trị.
 * Slug chỉ gồm chữ thường, số và gạch nối (cùng ràng buộc với cột `slug` trong DB), mã mẫu là chữ S và các chữ số;
 * thứ gì khác đều đưa về trang danh sách, nên không chuỗi lạ nào từ URL đi tiếp vào lời gọi API.
 */
export function parseRoute(hash: string): Route {
  if (Object.hasOwn(PAGES, hash)) return PAGES[hash];
  const edit = /^#\/mine\/(S[0-9]{7,18})\/edit$/.exec(hash);
  if (edit) return { page: "editSample", internalId: edit[1] };
  const match = /^#\/d\/([a-z0-9][a-z0-9-]{0,99})(?:\/t\/(S[0-9]{7,18}))?$/.exec(hash);
  return match ? { page: "dataset", slug: match[1], tip: match[2] ?? null } : { page: "list" };
}
