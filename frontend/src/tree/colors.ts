import type { Column } from "./columns";

/**
 * Tám màu phân loại, theo đúng thứ tự đã qua kiểm tra tách biệt cho người mù màu (bảng màu tham chiếu của
 * quy trình dataviz, nền sáng #fcfcfb; kiểm bằng `validate_palette.js`: mọi mục đạt, ba màu có tương phản
 * dưới 3:1 nên giao diện luôn kèm chú giải và tooltip có chữ).
 */
export const PALETTE: readonly string[] = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];

/** Màu của các giá trị nằm ngoài tám giá trị được tô ("Khác"). */
export const OTHER_COLOR = "#8a8d91";

export interface Coloring {
  key: string;
  /** Màu của từng mã vẽ: tám màu đầu của bảng, rồi tới màu "Khác" nếu có giá trị bị gộp. */
  colors: string[];
  /** Mã vẽ của từng giá trị trong cột (chỉ số vào `colors`). */
  slotOfValue: Int32Array;
  /** Mã vẽ của từng tip; -1 là tip không có giá trị. */
  tipSlots: Int32Array;
  /** Mã vẽ của từng node, với cột có giá trị cho cả node trong; `null` với cột chỉ có ở tip. */
  nodeSlots: Int32Array | null;
  /** Các giá trị theo thứ tự hiện trong chú giải: giá trị được tô trước, phần gộp vào "Khác" sau. */
  order: number[];
  /** Số giá trị có màu riêng. */
  distinct: number;
}

/**
 * Gán màu cho các giá trị của một cột.
 *
 * Màu gắn với giá trị, tính một lần trên toàn bộ dataset, không tính lại khi lọc: lọc bớt mẫu không được làm
 * những giá trị còn lại đổi màu. Cột có nhiều hơn tám giá trị thì tám giá trị nhiều tip nhất có màu riêng,
 * phần còn lại chung một màu xám; không sinh thêm màu thứ chín.
 */
export function colorize(column: Column): Coloring {
  const valueCount = column.values.length;
  const byCount = Array.from({ length: valueCount }, (_, code) => code).sort(
    (a, b) => column.counts[b] - column.counts[a] || a - b,
  );
  const distinct = Math.min(valueCount, PALETTE.length);
  // Ít giá trị: giữ thứ tự của cột (genotype I, II, III đọc theo thứ tự). Nhiều giá trị: theo số tip.
  const coloured = valueCount <= PALETTE.length ? byCount.slice().sort((a, b) => a - b) : byCount.slice(0, distinct);
  const others = valueCount <= PALETTE.length ? [] : byCount.slice(distinct);

  const slotOfValue = new Int32Array(valueCount).fill(distinct);
  coloured.forEach((code, slot) => {
    slotOfValue[code] = slot;
  });
  const colors = PALETTE.slice(0, distinct);
  if (others.length > 0) colors.push(OTHER_COLOR);

  const slots = (codes: Int32Array): Int32Array => {
    const out = new Int32Array(codes.length);
    for (let i = 0; i < codes.length; i++) out[i] = codes[i] < 0 ? -1 : slotOfValue[codes[i]];
    return out;
  };
  return {
    key: column.key,
    colors,
    slotOfValue,
    tipSlots: slots(column.tipCodes),
    nodeSlots: column.nodeCodes ? slots(column.nodeCodes) : null,
    order: [...coloured, ...others],
    distinct,
  };
}
