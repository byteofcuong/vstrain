/// <reference lib="webworker" />
/**
 * Web Worker tải và phân tích dữ liệu của một dataset.
 *
 * Tải JSON, kiểm tra và dựng typed array đều chạy ở đây, ngoài main thread; kết quả được chuyển về bằng
 * transfer (đổi chủ buffer, không sao chép). Main thread chỉ còn việc vẽ.
 */
import type { TreeShape } from "../tree/columns";
import {
  buildTree,
  columnBuffers,
  fetchJson,
  fileUrl,
  loadColumn,
  loadManifest,
  loadTips,
  treeBuffers,
  type Manifest,
} from "./load";
import type { Reply, Request } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let manifestUrl = "";
let manifest: Manifest | null = null;
/** Bản sao cấu trúc cây giữ lại ở worker, cần để dựng cột theo node sau khi cây đã được chuyển đi. */
let shape: TreeShape | null = null;

function reply(message: Reply, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function open(url: string): Promise<void> {
  manifestUrl = url;
  manifest = await loadManifest(fetchJson, url);
  reply({ type: "manifest", manifest });

  const started = performance.now();
  const file = await fetchJson(fileUrl(url, manifest.files.tree.path));
  const fetched = performance.now();
  const tree = buildTree(file, manifest);
  shape = { nodeCount: tree.nodeCount, tipCount: tree.tipCount, tipNode: tree.tipNode.slice() };
  const milliseconds = { fetch: fetched - started, parse: performance.now() - fetched };
  reply({ type: "tree", tree, milliseconds }, treeBuffers(tree));

  reply({ type: "tips", tips: await loadTips(fetchJson, url, manifest) });
}

async function column(key: string): Promise<void> {
  if (!manifest || !shape) throw new Error("No dataset is open");
  const loaded = await loadColumn(fetchJson, manifestUrl, manifest, shape, key);
  reply({ type: "column", key, column: loaded }, columnBuffers(loaded));
}

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "open") {
    open(request.manifestUrl).catch((error) => reply({ type: "error", about: "dataset", message: text(error) }));
  } else {
    column(request.key).catch((error) =>
      reply({ type: "error", about: "column", key: request.key, message: text(error) }),
    );
  }
};
