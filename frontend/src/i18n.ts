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

  map: { vi: "Bản đồ", en: "Map" },
  mapShown: { vi: "Hiện", en: "Shown" },
  mapHidden: { vi: "Ẩn", en: "Hidden" },
  mapTitle: { vi: "Mẫu theo địa bàn", en: "Samples by area" },
  mapOf: { vi: "Bản đồ Việt Nam theo {level}", en: "Map of Vietnam by {level}" },
  mapGrain: { vi: "Cấp địa bàn", en: "Level" },
  grainMacro: { vi: "Miền", en: "Macro-region" },
  grainRegion: { vi: "Vùng", en: "Region" },
  grainProvince: { vi: "Tỉnh", en: "Province" },
  byMacro: { vi: "miền", en: "macro-region" },
  byRegion: { vi: "vùng", en: "region" },
  byProvince: { vi: "tỉnh", en: "province" },
  provinceSet: { vi: "Bộ đơn vị cấp tỉnh", en: "Set of provinces" },
  setCurrent: { vi: "34 đơn vị", en: "34 units" },
  setOld: { vi: "63 tỉnh", en: "63 provinces" },
  setCurrentHint: {
    vi: "34 đơn vị có hiệu lực từ 1/7/2025. Mẫu lấy trước đó được tính vào đơn vị kế thừa tỉnh cũ.",
    en: "The 34 units took effect on 1 July 2025. Earlier samples count for the unit that succeeded their province.",
  },
  setOldHint: {
    vi: "63 tỉnh trước 1/7/2025. Mẫu chỉ mang mã của đơn vị mới không xếp được vào một tỉnh cũ.",
    en: "The 63 provinces before 1 July 2025. A sample that only has a current unit cannot be placed in one of them.",
  },
  mapPlaced: {
    vi: "{placed} trong {home} mẫu Việt Nam đang hiện xếp được theo {level}.",
    en: "{placed} of the {home} samples from Vietnam shown can be placed by {level}.",
  },
  mapPlacedOnly: {
    vi: "{placed} mẫu đang hiện xếp được theo {level}.",
    en: "{placed} samples shown can be placed by {level}.",
  },
  mapUnplaced: {
    vi: "{count} mẫu còn lại chỉ khai nơi lấy mẫu ở cấp thô hơn, hoặc không khai.",
    en: "The other {count} give a coarser place, or none.",
  },
  mapLoading: { vi: "Đang tải bản đồ…", en: "Loading the map…" },
  mapLoadFailed: {
    vi: "Không tải được bản đồ. Cây vẫn dùng được.",
    en: "Could not load the map. The tree still works.",
  },
  mapDataFailed: {
    vi: "Không tải được dữ liệu địa bàn của các mẫu. Cây vẫn dùng được.",
    en: "Could not load where the samples are from. The tree still works.",
  },
  areaSamples: { vi: "{name}: {count} mẫu", en: "{name}: {count} samples" },
  areaSamplesOf: { vi: "{name}: {shown} trong {count} mẫu", en: "{name}: {shown} of {count} samples" },
  areaEmpty: { vi: "Không có mẫu", en: "No samples" },
  samplesCount: { vi: "{count} mẫu", en: "{count} samples" },
  samplesCountOf: { vi: "{shown} trong {count} mẫu", en: "{shown} of {count} samples" },
  mapScale: { vi: "Số mẫu đang hiện", en: "Samples shown" },
  mapList: { vi: "Địa bàn có mẫu", en: "Areas with samples" },
  mapListHint: {
    vi: "Bấm vào một địa bàn, trên bản đồ hoặc trong danh sách, để chỉ xem mẫu của nó.",
    en: "Select an area, on the map or in the list, to show only its samples.",
  },
  mapArea: { vi: "Địa bàn", en: "Area" },
  mapCount: { vi: "Số mẫu", en: "Samples" },
  mapNote: {
    vi: "Màu theo số trình tự đã có, không phải số ca bệnh. Đường biên là sơ đồ, không dùng để xác định địa giới.",
    en: "Colour shows how many sequences there are, not how many cases. Boundaries are schematic and do not define borders.",
  },
  mapCredit: {
    vi: "Đường biên: OCHA, nguồn Tổng cục Thống kê (CC BY-IGO) cho 34 đơn vị; geoBoundaries cho 63 tỉnh, vùng và miền.",
    en: "Boundaries: OCHA, source General Statistics Office of Vietnam (CC BY-IGO) for the 34 units; geoBoundaries for the 63 provinces, regions and macro-regions.",
  },
  logIn: { vi: "Đăng nhập", en: "Log in" },
  logOut: { vi: "Đăng xuất", en: "Log out" },
  loggingIn: { vi: "Đang đăng nhập…", en: "Logging in…" },
  loginIntro: {
    vi: "Đăng nhập để nộp mẫu. Xem dữ liệu thì không cần tài khoản.",
    en: "Log in to submit samples. Viewing the data needs no account.",
  },
  email: { vi: "Email", en: "Email" },
  password: { vi: "Mật khẩu", en: "Password" },
  loginWrong: {
    vi: "Email hoặc mật khẩu không đúng, hoặc tài khoản đang tạm khoá vì nhập sai nhiều lần. Nếu bạn chắc mật khẩu đúng, thử lại sau 15 phút.",
    en: "Wrong email or password, or the account is locked for a while after too many wrong attempts. If you are sure of the password, try again in 15 minutes.",
  },
  loginBusy: {
    vi: "Máy chủ đang kiểm tra nhiều lần đăng nhập cùng lúc. Thử lại sau giây lát.",
    en: "The server is checking many logins at once. Try again in a moment.",
  },
  loginError: {
    vi: "Không đăng nhập được vì lỗi của máy chủ hoặc đường truyền. Thử lại.",
    en: "Could not log in because of a server or network problem. Try again.",
  },
  accountNote: { vi: "Tài khoản do quản trị viên cấp.", en: "Accounts are issued by an administrator." },
  areaFilter: { vi: "Địa bàn", en: "Area" },
  removeAreaFilter: { vi: "Bỏ lọc theo địa bàn", en: "Remove the area filter" },
  submitSample: { vi: "Nộp mẫu", en: "Submit a sample" },
  mySamples: { vi: "Mẫu của tôi", en: "My samples" },
  allSubmissions: { vi: "Mọi mẫu đã nộp", en: "All submissions" },
  onlyMine: { vi: "Chỉ mẫu của tôi", en: "Only mine" },
  submissionsShown: { vi: "Danh sách", en: "List" },
  submitIntro: {
    vi: "Nộp một genome dengue. Mẫu được kiểm tra chất lượng rồi gắn tạm lên cây trong vài giây; vị trí chính thức có sau lần dựng cây kế tiếp.",
    en: "Submit one dengue genome. It is quality-checked and attached to the tree provisionally within seconds; its official position comes with the next tree build.",
  },
  sampleName: { vi: "Tên mẫu", en: "Sample name" },
  sampleNameHint: {
    vi: "Viết như phòng xét nghiệm vẫn gọi; có dấu tiếng Việt cũng được.",
    en: "Write it as your lab does; Vietnamese accents are fine.",
  },
  datePrecision: { vi: "Ngày lấy mẫu biết tới", en: "Collection date known to the" },
  precisionDay: { vi: "Ngày", en: "Day" },
  precisionMonth: { vi: "Tháng", en: "Month" },
  precisionYear: { vi: "Năm", en: "Year" },
  province: { vi: "Tỉnh, thành nơi lấy mẫu", en: "Province where the sample was taken" },
  provinceHint: {
    vi: "Danh sách theo ngày lấy mẫu: 63 tỉnh, thành tới hết 30/6/2025; 34 đơn vị từ 1/7/2025.",
    en: "The list follows the collection date: 63 provinces until 30 June 2025; 34 units from 1 July 2025.",
  },
  chooseProvince: { vi: "Chọn tỉnh, thành", en: "Choose a province" },
  provinceNeedsDate: { vi: "Nhập ngày lấy mẫu trước", en: "Enter the collection date first" },
  provincesFailed: { vi: "Không tải được danh sách tỉnh, thành.", en: "Could not load the list of provinces." },
  provinceSet63: { vi: "63 tỉnh, thành (tới 30/6/2025)", en: "63 provinces (until 30 June 2025)" },
  provinceSet34: { vi: "34 đơn vị (từ 1/7/2025)", en: "34 units (from 1 July 2025)" },
  hostHuman: { vi: "Người (Homo sapiens)", en: "Human (Homo sapiens)" },
  hostAegypti: { vi: "Muỗi Aedes aegypti", en: "Aedes aegypti mosquito" },
  hostAlbopictus: { vi: "Muỗi Aedes albopictus", en: "Aedes albopictus mosquito" },
  hostUnknown: { vi: "Không rõ", en: "Not known" },
  fastaFile: { vi: "File FASTA", en: "FASTA file" },
  fastaHint: {
    vi: "Một genome, tối đa 2 MB. Tên ghi trong file không được dùng.",
    en: "One genome, at most 2 MB. The name written in the file is not used.",
  },
  submitting: { vi: "Đang gửi…", en: "Sending…" },
  submitNeedsLogin: { vi: "Đăng nhập để nộp mẫu.", en: "Log in to submit a sample." },
  submitFailed: {
    vi: "Không gửi được vì lỗi của máy chủ hoặc đường truyền. Thử lại.",
    en: "Could not send because of a server or network problem. Try again.",
  },
  submitTooMany: {
    vi: "Bạn đang có nhiều mẫu chờ kiểm tra. Chờ chúng xong rồi nộp tiếp.",
    en: "Many of your samples are still being checked. Wait for them to finish, then submit again.",
  },
  fixProblems: {
    vi: "Chưa nộp được. Sửa các chỗ được đánh dấu rồi nộp lại.",
    en: "Not submitted yet. Fix the marked fields and submit again.",
  },
  problem_NOT_FASTA: {
    vi: "File không phải FASTA: dòng đầu phải bắt đầu bằng dấu >.",
    en: "Not a FASTA file: the first line must start with >.",
  },
  problem_MULTIPLE_SEQUENCES: {
    vi: "File có nhiều hơn một chuỗi. Mỗi lần nộp một chuỗi.",
    en: "The file holds more than one sequence. Submit one at a time.",
  },
  problem_EMPTY_SEQUENCE: {
    vi: "File không có chuỗi nào dưới dòng tiêu đề.",
    en: "There is no sequence under the header line.",
  },
  problem_INVALID_CHARACTERS: {
    vi: "Chuỗi có ký tự không phải mã nucleotide.",
    en: "The sequence has a character that is not a nucleotide code.",
  },
  problem_SEQUENCE_TOO_SHORT: {
    vi: "Chuỗi quá ngắn để là một genome dengue (cần ít nhất 10.000 nucleotide).",
    en: "The sequence is too short for a dengue genome (at least 10,000 nucleotides are needed).",
  },
  problem_SEQUENCE_TOO_LONG: {
    vi: "Chuỗi dài hơn một genome dengue.",
    en: "The sequence is longer than a dengue genome.",
  },
  problem_TOO_FEW_KNOWN_BASES: {
    vi: "Chuỗi có quá nhiều vị trí không đọc được (cần ít nhất 10.000 vị trí là A, C, G hoặc T).",
    en: "Too many positions of the sequence are unreadable (at least 10,000 must be A, C, G or T).",
  },
  problem_FASTA_TOO_LARGE: { vi: "File lớn hơn 2 MB.", en: "The file is larger than 2 MB." },
  problem_FILE_REQUIRED: { vi: "Chọn một file FASTA.", en: "Choose a FASTA file." },
  problem_INVALID_NAME: {
    vi: "Tên mẫu phải có từ 1 tới 300 ký tự, viết trên một dòng.",
    en: "The sample name must be 1 to 300 characters on one line.",
  },
  problem_INVALID_DATE: { vi: "Ngày lấy mẫu không hợp lệ.", en: "The collection date is not valid." },
  problem_DATE_IN_FUTURE: { vi: "Ngày lấy mẫu ở tương lai.", en: "The collection date is in the future." },
  problem_INVALID_HOST: { vi: "Vật chủ không hợp lệ.", en: "The host is not valid." },
  problem_UNKNOWN_UNIT: { vi: "Chọn một tỉnh, thành trong danh sách.", en: "Choose a province from the list." },
  problem_UNIT_NOT_VALID_ON_DATE: {
    vi: "Tỉnh, thành này không tồn tại vào ngày lấy mẫu.",
    en: "This province did not exist on the collection date.",
  },
  problem_OTHER: { vi: "Giá trị không hợp lệ.", en: "The value is not valid." },
  mySamplesIntro: { vi: "Các mẫu bạn đã nộp, mới nhất ở trên.", en: "The samples you have submitted, newest first." },
  allSubmissionsIntro: {
    vi: "Mẫu của mọi người nộp, mới nhất ở trên.",
    en: "Samples from every submitter, newest first.",
  },
  noSubmissions: { vi: "Chưa có mẫu nào được nộp.", en: "No sample has been submitted yet." },
  submissionsFailed: { vi: "Không tải được danh sách mẫu.", en: "Could not load the samples." },
  submittedNotice: {
    vi: "Đã nhận mẫu {name}. Việc kiểm tra thường xong trong vài giây; trang này tự cập nhật.",
    en: "Sample {name} received. The check usually finishes within seconds; this page updates itself.",
  },
  submittedAt: { vi: "Nộp lúc", en: "Submitted" },
  submitter: { vi: "Người nộp", en: "Submitted by" },
  stageLabel: { vi: "Tình trạng", en: "Status" },
  stage_processing: { vi: "Đang kiểm tra", en: "Being checked" },
  stage_failed: {
    vi: "Việc kiểm tra bị lỗi; quản trị viên sẽ xem lại",
    en: "The check broke down; an administrator will look at it",
  },
  stage_rejected: { vi: "Không đạt kiểm tra chất lượng", en: "Did not pass the quality check" },
  stage_hidden: { vi: "Đã bị quản trị viên ẩn", en: "Hidden by an administrator" },
  stage_accepted: { vi: "Đạt kiểm tra; chưa có cây để gắn tạm", en: "Passed the check; no tree to attach it to yet" },
  stage_placed: { vi: "Đang là mẫu tạm trên cây", en: "A provisional sample on the tree" },
  stage_in_tree: { vi: "Đã vào cây chính thức", en: "In the official tree" },
  reject_NOT_THIS_PATHOGEN: {
    vi: "Chuỗi không đủ gần với reference của serotype dengue nào.",
    en: "The sequence is not close enough to the reference of any dengue serotype.",
  },
  reject_TOO_FEW_VALID_SITES: {
    vi: "Sau khi gióng theo reference, số vị trí đọc được không đủ (cần 10.000).",
    en: "After alignment to the reference, too few positions are readable (10,000 are needed).",
  },
  reject_OTHER: { vi: "Mẫu không qua được bước kiểm tra.", en: "The sample did not get through the check." },
  serotype: { vi: "Serotype", en: "Serotype" },
  viewOnTree: { vi: "Xem trên cây {title}", en: "See on the tree {title}" },
  hideSample: { vi: "Ẩn mẫu này", en: "Hide this sample" },
  unhideSample: { vi: "Hiện lại", en: "Show again" },
  actionFailed: { vi: "Không làm được việc này. Thử lại.", en: "That did not work. Try again." },
  provisional: { vi: "Mẫu tạm", en: "Provisional samples" },
  provisionalSummary: {
    vi: "{count} mẫu vừa nộp, chưa qua lần dựng cây nào.",
    en: "{count} submitted since the last tree build.",
  },
  provisionalNote: {
    vi: "Mỗi mẫu tạm được gắn vào cành gần nó nhất, vẽ bằng một hình thoi rỗng nối bằng nét đứt. Trên trục thời gian nó đứng ở ngày lấy mẫu do người nộp khai. Vị trí chính thức có sau lần dựng cây kế tiếp.",
    en: "Each provisional sample is attached to the branch nearest to it and drawn as a hollow diamond on a dashed line. On the time axis it sits at the collection date its lab declared. Its official position comes with the next tree build.",
  },
  provisionalFiltered: {
    vi: "Mẫu tạm không hiện khi đang lọc theo thuộc tính hoặc địa bàn.",
    en: "Provisional samples are not shown while an attribute or area filter is on.",
  },
  provisionalFailed: { vi: "Không tải được các mẫu tạm.", en: "Could not load the provisional samples." },
  provisionalSample: { vi: "Mẫu tạm", en: "Provisional sample" },
  provisionalTag: { vi: "tạm", en: "provisional" },
  provisionalPanelNote: {
    vi: "Vị trí trên cây là tạm thời, do Nextclade ước lượng từ cây của bản dựng hiện hành.",
    en: "The position on the tree is provisional, estimated by Nextclade from the tree of the current build.",
  },
  declaredDate: { vi: "Ngày lấy mẫu (người nộp khai)", en: "Collection date (as declared)" },
  genotype: { vi: "Genotype", en: "Genotype" },
  privateMutations: { vi: "Đột biến riêng", en: "Private mutations" },
  privateMutationsValue: {
    vi: "{count} thay thế nucleotide so với chỗ gắn",
    en: "{count} nucleotide substitutions from where it attaches",
  },
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
