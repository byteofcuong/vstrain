import { describe, expect, it } from "vitest";

import { dayRange, decimalYear, isoDate, niceTicks } from "./dates";

const DAY = 86_400_000;

/** Mọi ngày của một năm, dạng YYYY-MM-DD. */
function daysOf(year: number): string[] {
  const days: string[] = [];
  for (let time = Date.UTC(year, 0, 1); time < Date.UTC(year + 1, 0, 1); time += DAY) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

// Một năm thường và một năm nhuận.
const DAYS = [...daysOf(2019), ...daysOf(2020)];

/**
 * Ngày của một tip như nó nằm trong `tree.json`: TreeTime đặt tip vào giữa ngày lấy mẫu, và `augur export`
 * làm tròn 3 chữ số thập phân (0,001 năm là gần 9 giờ).
 */
function publishedValue(date: string): number {
  const year = Number(date.slice(0, 4));
  const days = daysOf(year);
  return Math.round((year + (days.indexOf(date) + 0.5) / days.length) * 1000) / 1000;
}

describe("dates", () => {
  it("converts calendar dates to decimal years and back", () => {
    expect(decimalYear("2019-01-01")).toBe(2019);
    expect(decimalYear("2019-07-02")).toBeCloseTo(2019.4986, 4);
    expect(isoDate(2019)).toBe("2019-01-01");
    for (const date of DAYS) {
      expect(isoDate(decimalYear(date)!)).toBe(date);
    }
  });

  it("names the day a moment falls in, not the nearest midnight", () => {
    // Giữa năm 2019 là 12 giờ trưa ngày 2 tháng 7.
    expect(isoDate(2019.5)).toBe("2019-07-02");
    expect(isoDate(2019.9999)).toBe("2019-12-31");
    expect(isoDate(2020.0001)).toBe("2020-01-01");
  });

  it("gives a tip of the published tree the day it was collected", () => {
    // Một mẫu của build DENV1 thật: lấy ngày 2017-06-06, nằm trong `tree.json` là 2017.429.
    expect(publishedValue("2017-06-06")).toBe(2017.429);
    expect(isoDate(2017.429)).toBe("2017-06-06");
    for (const date of DAYS) {
      expect(isoDate(publishedValue(date))).toBe(date);
    }
  });

  it("keeps a day when its first moment is off by a floating-point error", () => {
    for (const date of DAYS) {
      expect(isoDate(decimalYear(date)! - 1e-12)).toBe(date);
    }
  });

  it("rejects text that is not a real calendar date", () => {
    for (const text of ["", "2019", "2019-13-01", "2019-02-30", "19-01-01", "2019-1-1", "abcd-ef-gh"]) {
      expect(decimalYear(text)).toBeNull();
    }
  });

  it("picks round tick values that cover the range", () => {
    expect(niceTicks(1840.2, 2024.6, 8)).toEqual([1850, 1900, 1950, 2000]);
    expect(niceTicks(2010.3, 2019.8, 10)).toEqual([2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]);
    expect(niceTicks(0, 0.11, 5)).toEqual([0, 0.05, 0.1]);
    expect(niceTicks(5, 5, 5)).toEqual([]);
  });
});

describe("dayRange", () => {
  /** Thời điểm `moment` có nằm trong khoảng ngày từ `first` tới `last` theo `dayRange` không. */
  function holds(first: string | null, last: string | null, moment: number): boolean {
    const [from, before] = dayRange(first, last);
    return moment >= from && moment < before;
  }

  it("holds exactly the moments that fall on its days, both ends included", () => {
    // Các thời điểm thử: lưới 0,001 năm của file publish, cộng đầu mỗi ngày và sát hai bên đầu ngày.
    const moments: number[] = [];
    for (let step = 0; step <= 2000; step++) moments.push(2019 + step / 1000);
    for (const date of DAYS) {
      const start = decimalYear(date)!;
      moments.push(start, start - 1e-12, start + 1e-12, start - 1e-4, start + 1e-4);
    }
    const ranges: [string, string][] = [
      ["2019-03-15", "2019-03-15"],
      ["2019-01-01", "2019-12-31"],
      ["2019-12-31", "2020-01-01"],
      ["2020-02-28", "2020-03-01"],
      ["2020-07-02", "2020-12-31"],
    ];

    for (const [first, last] of ranges) {
      for (const moment of moments) {
        const day = isoDate(moment);
        expect(holds(first, last, moment), `${moment} (${day}) in ${first}..${last}`).toBe(first <= day && day <= last);
      }
    }
  });

  it("keeps a tip of the real build that sits at the very end of its day", () => {
    // Một tip của build DENV1 thật có ngày trên cây 2007.463: 23 giờ 53 ngày 18 tháng 6 năm 2007.
    expect(isoDate(2007.463)).toBe("2007-06-18");
    expect(holds("2007-06-18", "2007-06-18", 2007.463)).toBe(true);
    expect(holds(null, "2007-06-17", 2007.463)).toBe(false);
    expect(holds("2007-06-19", null, 2007.463)).toBe(false);
  });

  it("has no limit on a side that is not given or is not a real date", () => {
    expect(dayRange(null, null)).toEqual([-Infinity, Infinity]);
    expect(dayRange("2019-03-15", null)[1]).toBe(Infinity);
    expect(dayRange(null, "2019-03-15")[0]).toBe(-Infinity);
    expect(dayRange("2019-02-30", "not a date")).toEqual([-Infinity, Infinity]);
  });
});
