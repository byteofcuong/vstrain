import { formatNumber, type Lang } from "../i18n";

/**
 * Thang màu của bản đồ: số mẫu chia thành năm lớp, một sắc xanh lam ngọc từ nhạt tới đậm (nhiều hơn thì đậm hơn).
 * Sắc này không có trong bảng màu phân loại của cây, để không ai đọc nhầm màu của một tỉnh thành màu của một
 * genotype. Đã qua `validate_palette.js --ordinal` trên nền #fcfcfb: độ sáng giảm đều, lớp nhạt nhất tương phản
 * 2,01:1 với nền.
 *
 * Ranh giới các lớp cố định, không tính lại theo dữ liệu: lọc xong thì màu của một địa bàn chỉ đổi khi số mẫu
 * của nó sang lớp khác, và chú giải không nhảy.
 */
export const SCALE: readonly { from: number; color: string }[] = [
  { from: 1, color: "#7fbfc5" },
  { from: 10, color: "#55a3ab" },
  { from: 50, color: "#32868f" },
  { from: 200, color: "#17686f" },
  { from: 1000, color: "#0b4a51" },
];

/** Màu của địa bàn không có mẫu nào đang hiện: đất trống, lặng hơn mọi lớp có mẫu. */
export const EMPTY_COLOR = "#e4e9e7";

/** Màu của một địa bàn theo số mẫu đang hiện của nó. */
export function colorOf(count: number): string {
  let color = EMPTY_COLOR;
  for (const step of SCALE) {
    if (count >= step.from) color = step.color;
  }
  return color;
}

/** Nhãn của từng lớp trong chú giải: "1–9", …, "≥ 1.000". */
export function scaleLabels(lang: Lang): string[] {
  return SCALE.map((step, index) => {
    const next = SCALE[index + 1];
    return next
      ? `${formatNumber(lang, step.from)}–${formatNumber(lang, next.from - 1)}`
      : `≥ ${formatNumber(lang, step.from)}`;
  });
}
