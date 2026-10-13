import { create } from "zustand";

import { translate, type Lang, type MessageKey } from "../i18n";
import type { MapLevel } from "../map/types";
import { NO_FILTERS, toggleArea, type Filters } from "../tree/filter";
import type { Axis, Layout } from "../tree/layout";

/**
 * Trạng thái giao diện: những lựa chọn của người xem. Dữ liệu cây KHÔNG nằm ở đây (xem `data/session.ts`):
 * store chỉ giữ vài giá trị nhỏ, nên một lần đổi màu hay lọc không kéo theo việc sao chép hay so sánh cây.
 */
/** Cấp địa bàn như người xem chọn: miền, vùng hoặc tỉnh (bộ tỉnh nào thì chọn riêng). */
export type MapGrain = "macro" | "region" | "province";
export type ProvinceSet = "vn34" | "vn63";

interface UiState {
  lang: Lang;
  layout: Layout;
  axis: Axis;
  /** Cột đang dùng để tô màu; `null` là không tô. */
  colorKey: string | null;
  filters: Filters;
  /** Tip đang được chọn (chỉ số tip), -1 là không chọn. */
  selectedTip: number;
  /** Tip tạm đang được chọn (mã nội bộ của mẫu); chọn một tip của build thì bỏ chọn tip tạm, và ngược lại. */
  selectedProvisional: string | null;
  /** Có vẽ các tip tạm (mẫu vừa nộp, chưa qua build) lên cây không. */
  showProvisional: boolean;
  /** Bảng bản đồ có đang mở không. */
  mapOpen: boolean;
  /** Cấp địa bàn người xem đã chọn cho bản đồ; `null` là chưa chọn, bản đồ tự lấy cấp hợp với dữ liệu. */
  mapGrain: MapGrain | null;
  /** Bộ đơn vị cấp tỉnh dùng khi xem theo tỉnh: 34 đơn vị hiện hành hoặc 63 tỉnh trước 1/7/2025. */
  provinceSet: ProvinceSet;

  setLang(lang: Lang): void;
  setLayout(layout: Layout): void;
  setAxis(axis: Axis): void;
  setColorKey(key: string | null): void;
  /** Hai ngày dạng YYYY-MM-DD, tính cả hai; `null` là không giới hạn ở đầu đó. */
  setDateRange(dateFrom: string | null, dateTo: string | null): void;
  /** Bật hoặc tắt một giá trị trong bộ lọc của một cột. */
  toggleValue(key: string, code: number): void;
  clearColumnFilter(key: string): void;
  /** Bật hoặc tắt một địa bàn trong bộ lọc của bản đồ. */
  toggleArea(level: MapLevel, code: string): void;
  clearArea(): void;
  clearFilters(): void;
  setMapOpen(open: boolean): void;
  setMapGrain(grain: MapGrain): void;
  setProvinceSet(set: ProvinceSet): void;
  selectTip(tip: number): void;
  selectProvisional(internalId: string | null): void;
  setShowProvisional(show: boolean): void;
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
  selectedProvisional: null,
  showProvisional: true,
  mapOpen: true,
  mapGrain: null,
  provinceSet: "vn34",

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
  setDateRange: (dateFrom, dateTo) => set((state) => ({ filters: { ...state.filters, dateFrom, dateTo } })),
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
  toggleArea: (level, code) =>
    set((state) => ({ filters: { ...state.filters, area: toggleArea(state.filters.area, level, code) } })),
  clearArea: () => set((state) => ({ filters: { ...state.filters, area: null } })),
  clearFilters: () => set({ filters: NO_FILTERS }),
  setMapOpen: (mapOpen) => set({ mapOpen }),
  setMapGrain: (mapGrain) => set({ mapGrain }),
  setProvinceSet: (provinceSet) => set({ provinceSet }),
  selectTip: (selectedTip) => set({ selectedTip, selectedProvisional: null }),
  selectProvisional: (selectedProvisional) =>
    set((state) => ({ selectedProvisional, selectedTip: selectedProvisional === null ? state.selectedTip : -1 })),
  // Ẩn các tip tạm thì tip tạm đang chọn cũng thôi được chọn: không để bảng chi tiết nói về thứ không còn thấy.
  setShowProvisional: (showProvisional) =>
    set((state) => ({ showProvisional, selectedProvisional: showProvisional ? state.selectedProvisional : null })),
  // Cấp của bản đồ được chọn lại theo dữ liệu của dataset mới; việc mở hay đóng bảng bản đồ là thói quen, giữ nguyên.
  resetForDataset: () =>
    set({
      layout: "rect",
      axis: "time",
      colorKey: null,
      filters: NO_FILTERS,
      selectedTip: -1,
      selectedProvisional: null,
      mapGrain: null,
    }),
}));

/** Hàm dịch theo ngôn ngữ đang chọn. Đổi ngôn ngữ chỉ vẽ lại chữ, không đụng tới dữ liệu cây. */
export function useT(): (key: MessageKey, values?: Record<string, string | number>) => string {
  const lang = useUi((state) => state.lang);
  return (key, values) => translate(lang, key, values);
}
