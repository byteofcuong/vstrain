import type { TreeFile } from "./parse";

/**
 * Cây nhỏ viết tay dùng trong test:
 *
 *   0 gốc (2000)
 *   ├─ 1 A (2010)
 *   │  ├─ 2 tip a1 (2015)
 *   │  └─ 3 tip a2 (2020)
 *   └─ 4 B (2005)
 *      ├─ 5 tip b1 (2012)
 *      ├─ 6 tip b2 (2018)
 *      └─ 7 tip b3 (không có ngày)
 */
export function smallTree(): TreeFile {
  return {
    nodeCount: 8,
    tipCount: 5,
    name: ["root", "A", "a1", "a2", "B", "b1", "b2", "b3"],
    parent: [-1, 0, 1, 1, 0, 4, 4, 4],
    div: [0, 0.01, 0.02, 0.04, 0.005, 0.015, 0.03, 0.01],
    numDate: [2000, 2010, 2015, 2020, 2005, 2012, 2018, null],
    numDateLower: [1998, 2009, 2015, 2020, 2004, 2012, 2018, null],
    numDateUpper: [2002, 2011, 2015, 2020, 2006, 2012, 2018, null],
    tipNode: [2, 3, 5, 6, 7],
  };
}

/** Cây ngẫu nhiên có `tipCount` tip, theo đúng thứ tự duyệt trước; dùng cho test tính chất và đo hiệu năng. */
export function randomTree(tipCount: number, seed = 1): TreeFile {
  let state = seed >>> 0 || 1;
  const random = () => {
    // xorshift32: đủ ngẫu nhiên cho dữ liệu thử và cho cùng kết quả ở mọi máy.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };

  const file: TreeFile = {
    nodeCount: 0,
    tipCount: 0,
    name: [],
    parent: [],
    div: [],
    numDate: [],
    numDateLower: [],
    numDateUpper: [],
    tipNode: [],
  };
  // Mỗi mục: node cha, số tip mà cây con này phải có, ngày và độ phân kỳ của cha.
  const pending: [number, number, number, number][] = [[-1, tipCount, 1950, 0]];
  while (pending.length > 0) {
    const [parent, tips, parentDate, parentDiv] = pending.pop()!;
    const index = file.name.length;
    const date = parent < 0 ? parentDate : parentDate + 0.1 + random() * 4;
    const div = parent < 0 ? 0 : parentDiv + random() * 0.004;
    file.parent.push(parent);
    file.numDate.push(date);
    file.numDateLower.push(date - 0.5);
    file.numDateUpper.push(date + 0.5);
    file.div.push(div);
    if (tips === 1) {
      file.name.push(`S${String(file.tipNode.length).padStart(7, "0")}`);
      file.tipNode.push(index);
      continue;
    }
    file.name.push(`NODE_${String(index).padStart(7, "0")}`);
    const left = 1 + Math.floor(random() * (tips - 1));
    // Đẩy nhánh phải trước để nhánh trái được lấy ra trước, giữ thứ tự duyệt trước.
    pending.push([index, tips - left, date, div]);
    pending.push([index, left, date, div]);
  }
  file.nodeCount = file.name.length;
  file.tipCount = file.tipNode.length;
  return file;
}
