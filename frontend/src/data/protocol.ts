import type { Column } from "../tree/columns";
import type { Tree } from "../tree/parse";
import type { Manifest, TipInfo } from "./load";

/** Thông điệp main thread gửi cho worker. */
export type Request = { type: "open"; manifestUrl: string } | { type: "column"; key: string };

/**
 * Thông điệp worker gửi về. Sau "open", worker gửi lần lượt `manifest`, `tree`, rồi `tips`: cây về trước để
 * khung hình đầu tiên không phải chờ tên hiển thị của từng mẫu.
 */
export type Reply =
  | { type: "manifest"; manifest: Manifest }
  | { type: "tree"; tree: Tree; milliseconds: { fetch: number; parse: number } }
  | { type: "tips"; tips: TipInfo }
  | { type: "column"; key: string; column: Column }
  | { type: "error"; about: "dataset" | "column"; key?: string; message: string };
