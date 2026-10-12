import { create } from "zustand";

import { translate, type Lang, type MessageKey } from "../i18n";
import { NO_FILTERS, type Filters } from "../tree/filter";
import type { Axis, Layout } from "../tree/layout";

/**
 * Trạng thái giao diện: những lựa chọn của người xem. Dữ liệu cây KHÔNG nằm ở đây (xem `data/session.ts`):
 * store chỉ giữ vài giá trị nhỏ, nên một lần đổi màu hay lọc không kéo theo việc sao chép hay so sánh cây.
 */
interface UiState {
  lang: Lang;
  layout: Layout;
  axis: Axis;
  /** Cột đang dùng để tô màu; `null` là không tô. */
  colorKey: string | null;
  filters: Filters;
  /** Tip đang được chọn (chỉ số tip), -1 là không chọn. */
  selectedTip: number;

  setLang(lang: Lang): void;
  setLayout(layout: Layout): void;
  setAxis(axis: Axis): void;
  setColorKey(key: string | null): void;
  setDateRange(dateMin: number | null, dateMax: number | null): void;
  /** Bật hoặc tắt một giá trị trong bộ lọc của một cột. */
  toggleValue(key: string, code: number): void;
  clearColumnFilter(key: string): void;
  clearFilters(): void;
  selectTip(tip: number): void;
  /** Về trạng thái ban đầu khi mở một dataset khác (giữ ngôn ngữ). */
  resetForDataset(): void;
}

const LANG_STORAGE_KEY = "vietstrain.lang";

function initialLang(): Lang {
  try {
    const stored = globalThis.localStorage?.getItem(LANG_STORAGE_KEY);
    if (stored === "vi" || stored === "en") return stored;
  } catch {
    // Trình duyệt chặn localStorage: dùng mặc định.
  }
  return "vi";
}

export const useUi = create<UiState>((set) => ({
  lang: initialLang(),
  layout: "rect",
  axis: "time",
  colorKey: null,
  filters: NO_FILTERS,
  selectedTip: -1,

  setLang(lang) {
    try {
      globalThis.localStorage?.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // Không lưu được thì lựa chọn chỉ có hiệu lực trong lần mở này.
    }
    set({ lang });
  },
  setLayout: (layout) => set({ layout }),
  setAxis: (axis) => set({ axis }),
  setColorKey: (colorKey) => set({ colorKey }),
  setDateRange: (dateMin, dateMax) => set((state) => ({ filters: { ...state.filters, dateMin, dateMax } })),
  toggleValue: (key, code) =>
    set((state) => {
      const current = state.filters.values[key] ?? [];
      const next = current.includes(code) ? current.filter((other) => other !== code) : [...current, code];
      const values = { ...state.filters.values };
      if (next.length > 0) values[key] = next;
      else delete values[key];
      return { filters: { ...state.filters, values } };
    }),
  clearColumnFilter: (key) =>
    set((state) => {
      const values = { ...state.filters.values };
      delete values[key];
      return { filters: { ...state.filters, values } };
    }),
  clearFilters: () => set({ filters: NO_FILTERS }),
  selectTip: (selectedTip) => set({ selectedTip }),
  resetForDataset: () => set({ layout: "rect", axis: "time", colorKey: null, filters: NO_FILTERS, selectedTip: -1 }),
}));

/** Hàm dịch theo ngôn ngữ đang chọn. Đổi ngôn ngữ chỉ vẽ lại chữ, không đụng tới dữ liệu cây. */
export function useT(): (key: MessageKey, values?: Record<string, string | number>) => string {
  const lang = useUi((state) => state.lang);
  return (key, values) => translate(lang, key, values);
}
