/** Chuyển đổi giữa ngày lịch và "năm thập phân" (2019.5), dạng mà cây dùng cho trục thời gian. */

const DAY = 86_400_000;

function yearStart(year: number): number {
  return Date.UTC(year, 0, 1);
}

/** "2019-07-02" → 2019.5. Trả `null` khi chuỗi không phải một ngày hợp lệ dạng YYYY-MM-DD. */
export function decimalYear(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  // Date tự "sửa" ngày không có thật (30 tháng 2 thành 1 hoặc 2 tháng 3); ở đây coi đó là không hợp lệ.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return year + (time - yearStart(year)) / (yearStart(year + 1) - yearStart(year));
}

/** 2019.5 → "2019-07-02". */
export function isoDate(value: number): string {
  const year = Math.floor(value);
  const span = yearStart(year + 1) - yearStart(year);
  // Làm tròn tới ngày: năm thập phân trong file được làm tròn 4 chữ số, lệch chưa tới một giờ.
  const time = yearStart(year) + Math.round(((value - year) * span) / DAY) * DAY;
  return new Date(time).toISOString().slice(0, 10);
}

/** Các mốc "đẹp" (1, 2, 5 × 10ⁿ) phủ khoảng [min, max], khoảng `target` mốc. */
export function niceTicks(min: number, max: number, target: number): number[] {
  if (!(max > min) || target < 1) return [];
  const rough = (max - min) / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const ticks: number[] = [];
  // Nới một phần triệu bước ở hai đầu: giá trị lưu dạng float32 (0,04 thành 0,0399999991) không được làm
  // mất mốc nằm đúng ở đầu mút.
  const slack = 1e-6;
  for (let n = Math.ceil(min / step - slack); n * step <= max + step * slack; n++) {
    // Nhân rồi làm tròn để không ra 0.30000000000000004.
    ticks.push(Number((n * step).toPrecision(12)));
  }
  return ticks;
}
