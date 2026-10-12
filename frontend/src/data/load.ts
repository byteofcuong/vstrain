import { parseColumn, type Column, type ColumnFile, type TreeShape } from "../tree/columns";
import { parseTree, type Tree, type TreeFile } from "../tree/parse";

/** `manifest.json` của một bản publish (định dạng 1). */
export interface Manifest {
  format: number;
  dataset: { slug: string; title: string; pathogen: string; lineage: string };
  build: { id: number; createdAt: string };
  counts: { nodes: number; tips: number };
  /** `auspice` là cây gốc dạng Auspice v2, để tương thích; viewer không đọc nó. */
  files: { tree: FileEntry; tips: FileEntry; auspice?: FileEntry };
  columns: ColumnInfo[];
  contentHash: string;
}

export interface FileEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ColumnInfo {
  key: string;
  scope: "tip" | "node";
  type: string;
  title: { vi: string; en: string };
  valueCount: number;
  file: FileEntry;
}

/** `tips.json`: thông tin để hiển thị của từng tip, theo thứ tự tip. */
export interface TipInfo {
  displayName: string[];
  accession: (string | null)[];
  collectionDate: (string | null)[];
}

export const SUPPORTED_FORMAT = 1;

export class DatasetLoadError extends Error {}

export type FetchJson = (url: string) => Promise<unknown>;

/** Tên file trong manifest chỉ được là tên file trần: không đường dẫn, không URL sang nơi khác. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function fileUrl(manifestUrl: string, path: string): string {
  if (!FILE_NAME.test(path)) throw new DatasetLoadError(`Unexpected file name in manifest: ${path.slice(0, 80)}`);
  return manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1) + path;
}

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new DatasetLoadError(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function loadManifest(get: FetchJson, manifestUrl: string): Promise<Manifest> {
  const manifest = (await get(manifestUrl)) as Manifest;
  if (manifest?.format !== SUPPORTED_FORMAT) {
    throw new DatasetLoadError(`Unsupported dataset format: ${String(manifest?.format)}`);
  }
  return manifest;
}

/** Dựng cây từ nội dung `tree.json` và đối chiếu với số node, số tip ghi trong manifest. */
export function buildTree(file: unknown, manifest: Manifest): Tree {
  const tree = parseTree(file as TreeFile);
  if (tree.nodeCount !== manifest.counts.nodes || tree.tipCount !== manifest.counts.tips) {
    throw new DatasetLoadError("Tree file does not match the counts in the manifest");
  }
  return tree;
}

export async function loadTips(get: FetchJson, manifestUrl: string, manifest: Manifest): Promise<TipInfo> {
  const tips = (await get(fileUrl(manifestUrl, manifest.files.tips.path))) as TipInfo;
  for (const key of ["displayName", "accession", "collectionDate"] as const) {
    if (!Array.isArray(tips[key]) || tips[key].length !== manifest.counts.tips) {
      throw new DatasetLoadError(`Tip file: ${key} must have ${manifest.counts.tips} entries`);
    }
  }
  return tips;
}

export async function loadColumn(
  get: FetchJson,
  manifestUrl: string,
  manifest: Manifest,
  tree: TreeShape,
  key: string,
): Promise<Column> {
  const info = manifest.columns.find((column) => column.key === key);
  if (!info) throw new DatasetLoadError(`No column named ${key.slice(0, 80)}`);
  const file = (await get(fileUrl(manifestUrl, info.file.path))) as ColumnFile;
  return parseColumn({ ...file, key: info.key, scope: info.scope }, tree);
}

/** Các buffer của một cây, để chuyển giữa worker và main thread mà không sao chép. */
export function treeBuffers(tree: Tree): ArrayBuffer[] {
  return [
    tree.parent,
    tree.div,
    tree.numDate,
    tree.numDateLower,
    tree.numDateUpper,
    tree.tipNode,
    tree.tipOfNode,
    tree.order,
  ].map((array) => array.buffer as ArrayBuffer);
}

export function columnBuffers(column: Column): ArrayBuffer[] {
  // Cột theo tip dùng chung một mảng cho `tipCodes`; cột theo node có thêm `nodeCodes`.
  const arrays = [column.tipCodes, column.counts, ...(column.nodeCodes ? [column.nodeCodes] : [])];
  return arrays.map((array) => array.buffer as ArrayBuffer);
}
