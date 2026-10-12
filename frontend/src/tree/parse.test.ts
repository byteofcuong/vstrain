import { describe, expect, it } from "vitest";

import { randomTree, smallTree } from "./fixtures";
import { parseTree, TreeFormatError } from "./parse";

describe("parseTree", () => {
  it("turns the published arrays into typed arrays", () => {
    const tree = parseTree(smallTree());

    expect(tree.nodeCount).toBe(8);
    expect(tree.tipCount).toBe(5);
    expect(Array.from(tree.parent)).toEqual([-1, 0, 1, 1, 0, 4, 4, 4]);
    expect(Array.from(tree.tipOfNode)).toEqual([-1, -1, 0, 1, -1, 2, 3, 4]);
    expect(tree.numDate[3]).toBe(2020);
    expect(tree.tipNames).toEqual(["a1", "a2", "b1", "b2", "b3"]);
  });

  it("keeps a missing date or divergence as NaN instead of zero", () => {
    const file = smallTree();
    file.div[7] = null;

    const tree = parseTree(file);

    expect(tree.numDate[7]).toBeNaN();
    expect(tree.div[7]).toBeNaN();
  });

  it("puts each tip on its own row and each inner node between its outermost children", () => {
    const tree = parseTree(smallTree());

    // a1, a2 ở hàng 0 và 1; b1, b2, b3 ở hàng 2, 3, 4; A ở 0,5; B ở 3; gốc ở giữa A và B.
    expect(Array.from(tree.order)).toEqual([1.75, 0.5, 0, 1, 3, 2, 3, 4]);
  });

  it.each([
    ["a child listed before its parent", (file: ReturnType<typeof smallTree>) => (file.parent[2] = 5)],
    ["a parent index outside the tree", (file: ReturnType<typeof smallTree>) => (file.parent[3] = 99)],
    ["a second root", (file: ReturnType<typeof smallTree>) => (file.parent[4] = -1)],
    ["an array shorter than nodeCount", (file: ReturnType<typeof smallTree>) => file.div.pop()],
    ["a tip that points to an inner node", (file: ReturnType<typeof smallTree>) => (file.tipNode[0] = 1)],
    [
      "a leaf missing from the tip list",
      (file: ReturnType<typeof smallTree>) => {
        file.tipNode.pop();
        file.tipCount = 4;
      },
    ],
    ["tips out of tree order", (file: ReturnType<typeof smallTree>) => file.tipNode.reverse()],
    ["a tip count that disagrees with the tip list", (file: ReturnType<typeof smallTree>) => (file.tipCount = 6)],
  ])("rejects %s", (_name, corrupt) => {
    const file = smallTree();
    corrupt(file);

    expect(() => parseTree(file)).toThrow(TreeFormatError);
  });

  it("accepts a large random tree and keeps every tip on a distinct row", () => {
    const tree = parseTree(randomTree(5000, 3));

    expect(tree.tipCount).toBe(5000);
    expect(tree.nodeCount).toBe(9999);
    const rows = Array.from(tree.tipNode, (node) => tree.order[node]);
    expect(rows).toEqual(Array.from({ length: 5000 }, (_, k) => k));
  });
});
