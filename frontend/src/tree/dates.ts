/** Chuyển đổi giữa ngày lịch và "năm thập phân" (2019.5), dạng mà cây dùng cho trục thời gian. */

const DAY = 86_400_000;

function yearStart(year: number): number {
  return Date.UTC(year, 0, 1);
}

/** Một phần triệu ngày: đủ che sai số dấu phẩy động của năm thập phân, nhỏ hơn nhiều so với một ngày. */
const DAY_SLACK = 1e-6;

/** Đầu ngày của "2019-07-02", tính bằng mili giây. Trả `null` khi chuỗi không phải một ngày có thật. */
function dayTime(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  // Date tự "sửa" ngày không có thật (30 tháng 2 thành 1 hoặc 2 tháng 3); ở đây coi đó là không hợp lệ.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return time;
}

/** Một thời điểm tính bằng mili giây → năm thập phân. */
function yearOfTime(time: number): number {
  const year = new Date(time).getUTCFullYear();
  return year + (time - yearStart(year)) / (yearStart(year + 1) - yearStart(year));
}

/** "2019-07-02" → 2019.4986, đầu ngày đó. Trả `null` khi chuỗi không phải một ngày hợp lệ dạng YYYY-MM-DD. */
export function decimalYear(isoDate: string): number | null {
  const time = dayTime(isoDate);
  return time === null ? null : yearOfTime(time);
}

/**
 * Khoảng thời điểm [từ, trước) gồm đúng những thời điểm mà `isoDate` xếp vào các ngày từ `first` tới hết `last`.
 * Đầu nào là `null`, hoặc không phải một ngày có thật, thì không giới hạn ở đầu đó.
 */
export function dayRange(first: string | null, last: string | null): [number, number] {
  const from = first === null ? null : dayTime(first);
  const to = last === null ? null : dayTime(last);
  // Lùi cả hai mốc đúng bằng phần nới của `isoDate`, để hai hàm xếp mọi thời điểm vào cùng một ngày.
  const slack = DAY_SLACK * DAY;
  return [from === null ? -Infinity : yearOfTime(from - slack), to === null ? Infinity : yearOfTime(to + DAY - slack)];
}

/** 2019.5 → "2019-07-02": ngày lịch chứa thời điểm đó. */
export function isoDate(value: number): string {
  const year = Math.floor(value);
  const span = yearStart(year + 1) - yearStart(year);
  // Lấy phần nguyên, không làm tròn. Ngày của tip trong `tree.json` nằm giữa ngày lấy mẫu (quy ước của TreeTime)
  // và đã làm tròn 3 chữ số (lệch tới 0,18 ngày); làm tròn tới ngày gần nhất sẽ đẩy gần nửa số tip sang hôm sau.
  // Phần nới để giá trị đầu ngày do `decimalYear` tạo ra không rơi về hôm trước.
  const time = yearStart(year) + Math.floor(((value - year) * span) / DAY + DAY_SLACK) * DAY;
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
