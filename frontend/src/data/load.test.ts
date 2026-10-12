import { describe, expect, it } from "vitest";

import { smallTree } from "../tree/fixtures";
import { parseTree } from "../tree/parse";
import {
  buildTree,
  columnBuffers,
  DatasetLoadError,
  fileUrl,
  loadColumn,
  loadManifest,
  loadTips,
  treeBuffers,
  type FetchJson,
  type Manifest,
} from "./load";
import { searchTips } from "./search";

const MANIFEST_URL = "/builds/dengue-denv1/b000001/p-0123456789ab/manifest.json";
const BASE = "/builds/dengue-denv1/b000001/p-0123456789ab/";

function manifest(): Manifest {
  const entry = (path: string) => ({ path, bytes: 1, sha256: "0".repeat(64) });
  return {
    format: 1,
    dataset: { slug: "dengue-denv1", title: "DENV1", pathogen: "dengue", lineage: "denv1" },
    build: { id: 1, createdAt: "2026-10-12T08:31:44+00:00" },
    counts: { nodes: 8, tips: 5 },
    files: { tree: entry("tree.json"), tips: entry("tips.json"), auspice: entry("auspice.json") },
    columns: [
      {
        key: "clade",
        scope: "node",
        type: "categorical",
        title: { vi: "Genotype", en: "Genotype" },
        valueCount: 2,
        file: entry("col.clade.json"),
      },
      {
        key: "country",
        scope: "tip",
        type: "categorical",
        title: { vi: "Quốc gia", en: "Country" },
        valueCount: 2,
        file: entry("col.country.json"),
      },
    ],
    contentHash: "0".repeat(64),
  };
}

/** Một "máy chủ" trong bộ nhớ: trả nội dung theo URL và ghi lại những URL đã được hỏi. */
function server(files: Record<string, unknown>): { get: FetchJson; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    get: async (url) => {
      asked.push(url);
      if (!(url in files)) throw new DatasetLoadError(`${url}: HTTP 404`);
      return files[url];
    },
  };
}

describe("fileUrl", () => {
  it("resolves a file of the manifest next to the manifest", () => {
    expect(fileUrl(MANIFEST_URL, "tree.json")).toBe(`${BASE}tree.json`);
    expect(fileUrl(MANIFEST_URL, "col.country.json")).toBe(`${BASE}col.country.json`);
  });

  it.each([
    "../secret.json",
    "sub/tree.json",
    "/etc/passwd",
    "https://example.org/tree.json",
    "//example.org/x",
    "",
    ".hidden",
    "a b.json",
    "tree.json?x=1",
    "a\\b.json",
  ])("refuses %j, which is not a bare file name", (path) => {
    expect(() => fileUrl(MANIFEST_URL, path)).toThrow(DatasetLoadError);
  });
});

describe("loading a published dataset", () => {
  it("rejects a manifest of a format it does not know", async () => {
    const { get } = server({ [MANIFEST_URL]: { ...manifest(), format: 2 } });

    await expect(loadManifest(get, MANIFEST_URL)).rejects.toThrow("Unsupported dataset format: 2");
  });

  it("rejects something that is not a manifest at all", async () => {
    const { get } = server({ [MANIFEST_URL]: null });

    await expect(loadManifest(get, MANIFEST_URL)).rejects.toThrow(DatasetLoadError);
  });

  it("builds the tree and checks it against the counts of the manifest", () => {
    expect(buildTree(smallTree(), manifest()).tipCount).toBe(5);

    const wrong = manifest();
    wrong.counts.tips = 6;
    expect(() => buildTree(smallTree(), wrong)).toThrow("does not match the counts");
  });

  it("loads the tip names and rejects a file of the wrong length", async () => {
    const tips = {
      displayName: ["a", "b", "c", "d", "e"],
      accession: [null, "X1", null, null, null],
      collectionDate: ["2019-XX-XX", null, null, null, null],
    };
    const good = server({ [`${BASE}tips.json`]: tips });
    const short = server({ [`${BASE}tips.json`]: { ...tips, accession: ["X1"] } });

    await expect(loadTips(good.get, MANIFEST_URL, manifest())).resolves.toEqual(tips);
    await expect(loadTips(short.get, MANIFEST_URL, manifest())).rejects.toThrow("accession must have 5 entries");
  });

  it("loads a column from the file the manifest names for it", async () => {
    const tree = parseTree(smallTree());
    const { get, asked } = server({
      [`${BASE}col.country.json`]: {
        key: "country",
        scope: "tip",
        values: ["Vietnam", "Thailand"],
        codes: [0, 0, 1, -1, 0],
      },
    });

    const column = await loadColumn(get, MANIFEST_URL, manifest(), tree, "country");

    expect(asked).toEqual([`${BASE}col.country.json`]);
    expect(Array.from(column.counts)).toEqual([3, 1]);
  });

  it("trusts the manifest, not the column file, about what the column is", async () => {
    const tree = parseTree(smallTree());
    // File tự nhận là cột theo tip tên "country"; manifest nói đây là cột "clade" theo node.
    const { get } = server({
      [`${BASE}col.clade.json`]: {
        key: "country",
        scope: "tip",
        values: ["I", "II"],
        codes: [-1, 0, 0, 0, 1, 1, 1, 1],
      },
    });

    const column = await loadColumn(get, MANIFEST_URL, manifest(), tree, "clade");

    expect(column.key).toBe("clade");
    expect(column.nodeCodes).not.toBeNull();
    expect(Array.from(column.tipCodes)).toEqual([0, 0, 1, 1, 1]);
  });

  it("refuses a column the manifest does not list, without asking the server", async () => {
    const { get, asked } = server({});

    await expect(loadColumn(get, MANIFEST_URL, manifest(), parseTree(smallTree()), "../secret")).rejects.toThrow(
      "No column named",
    );
    expect(asked).toEqual([]);
  });

  it("refuses a manifest whose file name points somewhere else", async () => {
    const hostile = manifest();
    hostile.columns[1].file.path = "https://example.org/col.country.json";
    const { get, asked } = server({});

    await expect(loadColumn(get, MANIFEST_URL, hostile, parseTree(smallTree()), "country")).rejects.toThrow(
      "Unexpected file name",
    );
    expect(asked).toEqual([]);
  });
});

describe("transfer lists", () => {
  it("lists each buffer of a tree exactly once", () => {
    const buffers = treeBuffers(parseTree(smallTree()));

    expect(buffers).toHaveLength(8);
    expect(new Set(buffers).size).toBe(8);
  });

  it("lists each buffer of a column exactly once, for both kinds of column", async () => {
    const tree = parseTree(smallTree());
    const { get } = server({
      [`${BASE}col.country.json`]: { key: "country", scope: "tip", values: ["A"], codes: [0, 0, 0, -1, 0] },
      [`${BASE}col.clade.json`]: { key: "clade", scope: "node", values: ["I"], codes: [0, 0, 0, 0, 0, 0, 0, 0] },
    });

    const byTip = columnBuffers(await loadColumn(get, MANIFEST_URL, manifest(), tree, "country"));
    const byNode = columnBuffers(await loadColumn(get, MANIFEST_URL, manifest(), tree, "clade"));

    expect(new Set(byTip).size).toBe(byTip.length);
    expect(byTip).toHaveLength(2);
    expect(new Set(byNode).size).toBe(byNode.length);
    expect(byNode).toHaveLength(3);
  });
});

describe("searchTips", () => {
  const tips = {
    displayName: ["DENV-1/VN/BID-V3982/2008", "Hà_Nội/01/2024", "Brun2014", "ThD1_0442_80", "hà_nội/02/2024"],
    accession: ["GU131755", null, "KR919820", "AY732474", "gu131999"],
    collectionDate: [null, null, null, null, null],
  };

  it("matches the name or the accession, ignoring case", () => {
    expect(searchTips(tips, "gu131", 10)).toEqual({ matches: [0, 4], total: 2 });
    expect(searchTips(tips, "HÀ_NỘI", 10)).toEqual({ matches: [1, 4], total: 2 });
    expect(searchTips(tips, "brun", 10)).toEqual({ matches: [2], total: 1 });
  });

  it("keeps the first matches in tree order and still counts the rest", () => {
    expect(searchTips(tips, "20", 2)).toEqual({ matches: [0, 1], total: 4 });
  });

  it("does not search for fewer than two characters, ignoring surrounding spaces", () => {
    expect(searchTips(tips, "  b ", 10)).toEqual({ matches: [], total: 0 });
    expect(searchTips(tips, "", 10)).toEqual({ matches: [], total: 0 });
    expect(searchTips(tips, "  br  ", 10)).toEqual({ matches: [2], total: 1 });
  });

  it("treats the query as plain text, not as a pattern", () => {
    expect(searchTips(tips, ".*", 10)).toEqual({ matches: [], total: 0 });
    expect(searchTips(tips, "D1_", 10)).toEqual({ matches: [3], total: 1 });
  });
});
