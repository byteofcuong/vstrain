import type { TipInfo } from "./load";

/** Chuỗi tìm ngắn hơn mức này khớp gần như mọi mẫu, nên chưa tìm. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Các tip có tên hoặc accession chứa chuỗi tìm, không phân biệt hoa thường.
 * `matches` giữ tối đa `limit` tip đầu tiên theo thứ tự trong cây; `total` là tổng số tip khớp.
 */
export function searchTips(tips: TipInfo, query: string, limit: number): { matches: number[]; total: number } {
  const needle = query.trim().toLocaleLowerCase();
  const matches: number[] = [];
  let total = 0;
  if (needle.length < MIN_QUERY_LENGTH) return { matches, total };
  for (let tip = 0; tip < tips.displayName.length; tip++) {
    const accession = tips.accession[tip];
    if (
      tips.displayName[tip].toLocaleLowerCase().includes(needle) ||
      (accession !== null && accession.toLocaleLowerCase().includes(needle))
    ) {
      if (matches.length < limit) matches.push(tip);
      total++;
    }
  }
  return { matches, total };
}
