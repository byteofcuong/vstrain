import type { Column } from "../tree/columns";
import type { Tree } from "../tree/parse";
import type { Manifest, TipInfo } from "./load";
import type { Reply, Request } from "./protocol";

/**
 * Dữ liệu của dataset đang mở, nằm ngoài React.
 *
 * React chỉ nhận một "ảnh chụp" nhỏ (các tham chiếu tới cây, cột, và một số phiên bản tăng dần) qua
 * `useSyncExternalStore`; typed array của cây không bao giờ đi qua state hay props để bị so sánh hay sao chép.
 */
export interface DatasetSnapshot {
  status: "loading" | "ready" | "error";
  error: string | null;
  manifest: Manifest | null;
  tree: Tree | null;
  tips: TipInfo | null;
  /** Các cột đã tải. Map được thay bằng bản mới mỗi khi có thêm cột, để React nhận ra thay đổi. */
  columns: ReadonlyMap<string, Column>;
  /** Các cột tải không được, kèm thông báo lỗi; một cột rời khỏi đây khi được yêu cầu tải lại. */
  columnErrors: ReadonlyMap<string, string>;
  /** Thời gian tải và dựng cây trong worker (mili giây), để hiện thị và đo. */
  milliseconds: { fetch: number; parse: number } | null;
}

const EMPTY: DatasetSnapshot = {
  status: "loading",
  error: null,
  manifest: null,
  tree: null,
  tips: null,
  columns: new Map(),
  columnErrors: new Map(),
  milliseconds: null,
};

export class DatasetSession {
  private snapshot: DatasetSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private requested = new Set<string>();
  private worker: Worker;

  constructor(manifestUrl: string) {
    this.worker = new Worker(new URL("./loader.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<Reply>) => this.receive(event.data);
    this.worker.onerror = (event) => this.update({ status: "error", error: event.message || "Worker failed" });
    this.send({ type: "open", manifestUrl });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DatasetSnapshot => this.snapshot;

  /** Yêu cầu tải một cột; gọi nhiều lần cho cùng một cột chỉ tải một lần. */
  requestColumn(key: string): void {
    if (this.requested.has(key)) return;
    this.requested.add(key);
    if (this.snapshot.columnErrors.has(key)) {
      const columnErrors = new Map(this.snapshot.columnErrors);
      columnErrors.delete(key);
      this.update({ columnErrors });
    }
    this.send({ type: "column", key });
  }

  dispose(): void {
    this.worker.terminate();
    this.listeners.clear();
  }

  private send(request: Request): void {
    this.worker.postMessage(request);
  }

  private update(patch: Partial<DatasetSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private receive(reply: Reply): void {
    switch (reply.type) {
      case "manifest":
        this.update({ manifest: reply.manifest });
        break;
      case "tree":
        this.update({ tree: reply.tree, milliseconds: reply.milliseconds, status: "ready" });
        break;
      case "tips":
        this.update({ tips: reply.tips });
        break;
      case "column": {
        const columns = new Map(this.snapshot.columns);
        columns.set(reply.key, reply.column);
        this.update({ columns });
        break;
      }
      case "error":
        if (reply.about === "dataset") {
          this.update({ status: "error", error: reply.message });
        } else if (reply.key) {
          // Cây vẫn dùng được nên không chuyển cả phiên sang trạng thái lỗi; ghi lỗi riêng cho cột này để
          // giao diện báo cho người xem và cho thử lại.
          this.requested.delete(reply.key);
          const columnErrors = new Map(this.snapshot.columnErrors);
          columnErrors.set(reply.key, reply.message);
          this.update({ columnErrors });
        }
        break;
    }
  }
}
