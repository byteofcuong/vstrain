/**
 * Lớp dịch: mọi chuỗi hiển thị đi qua `t()`. Hai ngôn ngữ nằm cạnh nhau trong một bảng, nên thiếu một bản dịch
 * là lỗi kiểu lúc biên dịch chứ không phải một ô trống lúc chạy.
 */
export type Lang = "vi" | "en";

const MESSAGES = {
  appName: { vi: "VietStrain", en: "VietStrain" },
  appTagline: {
    vi: "Giám sát bộ gen mầm bệnh cho Việt Nam",
    en: "Pathogen genomic surveillance for Vietnam",
  },
  language: { vi: "Ngôn ngữ", en: "Language" },
  datasets: { vi: "Bộ dữ liệu", en: "Datasets" },
  datasetsIntro: {
    vi: "Mỗi bộ dữ liệu là một cây phát sinh loài được dựng lại theo lịch từ các mẫu đã nhập.",
    en: "Each dataset is a phylogenetic tree rebuilt on a schedule from the imported samples.",
  },
  samplesInTree: { vi: "{count} mẫu trong cây", en: "{count} samples in the tree" },
  publishedOn: { vi: "dựng ngày {date}", en: "built on {date}" },
  notBuiltYet: { vi: "Chưa có bản dựng", en: "Not built yet" },
  openTree: { vi: "Xem cây", en: "Open tree" },
  backToDatasets: { vi: "Tất cả bộ dữ liệu", en: "All datasets" },
  loading: { vi: "Đang tải…", en: "Loading…" },
  loadingTree: { vi: "Đang tải cây…", en: "Loading tree…" },
  loadFailed: { vi: "Không tải được dữ liệu", en: "Could not load the data" },
  retry: { vi: "Thử lại", en: "Try again" },
  datasetNotFound: { vi: "Không có bộ dữ liệu này", en: "This dataset does not exist" },
  datasetNotBuilt: {
    vi: "Bộ dữ liệu này chưa có bản dựng nào để xem.",
    en: "This dataset has no build to show yet.",
  },
  noDatasets: { vi: "Chưa có bộ dữ liệu nào.", en: "There are no datasets yet." },

  layout: { vi: "Bố cục", en: "Layout" },
  layoutRect: { vi: "Chữ nhật", en: "Rectangular" },
  layoutRadial: { vi: "Toả tròn", en: "Radial" },
  axis: { vi: "Trục", en: "Axis" },
  axisTime: { vi: "Thời gian", en: "Time" },
  axisDiv: { vi: "Độ phân kỳ", en: "Divergence" },
  colorBy: { vi: "Tô màu theo", en: "Colour by" },
  noColor: { vi: "Không tô màu", en: "No colour" },
  dateRange: { vi: "Khoảng ngày lấy mẫu", en: "Collection date range" },
  dateFrom: { vi: "Từ ngày", en: "From" },
  dateTo: { vi: "Đến ngày", en: "To" },
  legendHint: {
    vi: "Bấm vào một giá trị để chỉ xem các mẫu mang giá trị đó.",
    en: "Select a value to show only the samples that have it.",
  },
  otherValues: { vi: "Giá trị khác", en: "Other values" },
  missingValue: { vi: "Không có thông tin", en: "No information" },
  columnLoadFailed: {
    vi: "Không tải được dữ liệu của cột này. Cây vẫn dùng được.",
    en: "Could not load the data for this column. The tree still works.",
  },
  showing: { vi: "Đang hiện {shown} trong {total} mẫu", en: "Showing {shown} of {total} samples" },
  clearFilters: { vi: "Bỏ lọc", en: "Clear filters" },
  removeFilter: { vi: "Bỏ lọc theo {column}", en: "Remove the {column} filter" },
  noSamplesMatch: {
    vi: "Không mẫu nào khớp bộ lọc. Bỏ bớt điều kiện để thấy lại cây.",
    en: "No samples match the filters. Remove a condition to see the tree again.",
  },

  search: { vi: "Tìm mẫu", en: "Find a sample" },
  searchPlaceholder: { vi: "Tên mẫu hoặc mã accession", en: "Sample name or accession" },
  searchNone: { vi: "Không tìm thấy mẫu nào", en: "No sample found" },
  searchMore: {
    vi: "Còn {count} kết quả nữa; gõ thêm để thu hẹp.",
    en: "{count} more results; type more to narrow down.",
  },
  searchLoading: { vi: "Đang tải tên mẫu…", en: "Loading sample names…" },

  zoomIn: { vi: "Phóng to", en: "Zoom in" },
  zoomOut: { vi: "Thu nhỏ", en: "Zoom out" },
  zoomReset: { vi: "Xem cả cây", en: "Show whole tree" },
  treeHelp: {
    vi: "Lăn chuột để phóng theo chiều dọc, giữ Shift để phóng theo trục; kéo để di chuyển; bấm vào một mẫu để xem chi tiết.",
    en: "Scroll to zoom vertically, hold Shift to zoom along the axis; drag to move; select a sample to see its details.",
  },
  treeLabel: { vi: "Cây phát sinh loài của {title}", en: "Phylogenetic tree of {title}" },

  sample: { vi: "Mẫu", en: "Sample" },
  close: { vi: "Đóng", en: "Close" },
  accession: { vi: "Accession", en: "Accession" },
  collectionDate: { vi: "Ngày lấy mẫu", en: "Collection date" },
  inferredDate: { vi: "Ngày trên cây", en: "Date in the tree" },
  country: { vi: "Quốc gia", en: "Country" },
  place: { vi: "Địa danh gốc", en: "Place as submitted" },
  adminUnit: { vi: "Đơn vị hành chính", en: "Administrative unit" },
  host: { vi: "Vật chủ", en: "Host" },
  sequenceLength: { vi: "Độ dài chuỗi", en: "Sequence length" },
  nucleotides: { vi: "{count} nucleotide", en: "{count} nucleotides" },
  source: { vi: "Nguồn", en: "Source" },
  internalId: { vi: "Mã nội bộ", en: "Internal ID" },
  viewOnGenBank: { vi: "Xem trên GenBank", en: "View on GenBank" },
  sampleLoadFailed: { vi: "Không tải được thông tin của mẫu này.", en: "Could not load this sample." },
  unknown: { vi: "Không rõ", en: "Unknown" },
} as const;

export type MessageKey = keyof typeof MESSAGES;

/** Số theo cách viết của từng ngôn ngữ: 1.964 trong tiếng Việt, 1,964 trong tiếng Anh. */
export function formatNumber(lang: Lang, value: number): string {
  return new Intl.NumberFormat(lang === "vi" ? "vi-VN" : "en-GB").format(value);
}

export function translate(lang: Lang, key: MessageKey, values: Record<string, string | number> = {}): string {
  return MESSAGES[key][lang].replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) return whole;
    return typeof value === "number" ? formatNumber(lang, value) : value;
  });
}

export const MESSAGE_KEYS = Object.keys(MESSAGES) as MessageKey[];
