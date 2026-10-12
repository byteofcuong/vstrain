/** Cấp địa bàn mà bản đồ vẽ được. Cấp tỉnh có hai bộ: 63 tỉnh trước 1/7/2025 và 34 đơn vị sau đó. */
export type MapLevel = "macro" | "region" | "vn63" | "vn34";

/** Một địa bàn trên bản đồ, hình đã chiếu sẵn vào khung toạ độ của SVG. */
export interface MapArea {
  /** Mã trong bảng `admin_unit` của backend, cũng là giá trị trong cột `unit` hoặc `region` của bản publish. */
  code: string;
  vi: string;
  en: string;
  /** Mã vùng (với tỉnh bộ 63) hoặc mã miền (với vùng). */
  parent?: string;
  /** Đơn vị bộ 34 kế thừa một tỉnh bộ 63. */
  successor?: string;
  /** Mã tỉnh của Tổng cục Thống kê theo nguồn HDX, chỉ có ở bộ 34. */
  pcode?: string;
  /** Thuộc tính `d` của phần tử `<path>`; vẽ với `fill-rule: evenodd`. */
  d: string;
  /**
   * Các đảo của Hoàng Sa, Trường Sa thuộc địa bàn này, mỗi đảo một đoạn dài bằng 0: vẽ bằng nét có đầu tròn
   * (`stroke-linecap: round`) để mỗi đảo thành một chấm, vì ở tỉ lệ này hình của chúng nhỏ hơn một pixel.
   */
  dots?: string;
  /** Một điểm nằm trong phần lớn nhất của địa bàn, để đặt tooltip. */
  at: [number, number];
}

/** Nhãn của một quần đảo quá nhỏ để thấy hình. */
export interface MapLabel {
  vi: string;
  en: string;
  /** Điểm neo: giữa các đảo theo chiều ngang, ở mép bắc của chúng. Chữ được đặt phía trên điểm này. */
  at: [number, number];
}

export interface MapSource {
  levels: MapLevel[];
  name: string;
  license: string;
  url: string;
}

/** Nội dung của file hình học `vn-map.json`. */
export interface MapData {
  width: number;
  height: number;
  levels: Record<MapLevel, MapArea[]>;
  labels: MapLabel[];
  sources: MapSource[];
}
