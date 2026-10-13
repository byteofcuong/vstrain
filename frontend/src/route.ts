export type Route = { page: "list" } | { page: "dataset"; slug: string } | { page: "login" };

/**
 * Đường dẫn trong phần `#` của URL: `#/` là danh sách, `#/d/<slug>` là một dataset, `#/login` là trang đăng nhập.
 * Slug chỉ gồm chữ thường, số và gạch nối (cùng ràng buộc với cột `slug` trong DB); thứ gì khác đều đưa về
 * trang danh sách, nên không chuỗi lạ nào từ URL đi tiếp vào lời gọi API.
 */
export function parseRoute(hash: string): Route {
  if (hash === "#/login") return { page: "login" };
  const match = /^#\/d\/([a-z0-9][a-z0-9-]{0,99})$/.exec(hash);
  return match ? { page: "dataset", slug: match[1] } : { page: "list" };
}
