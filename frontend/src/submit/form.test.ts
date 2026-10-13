import { describe, expect, it } from "vitest";

import type { AdminUnit } from "../api";
import { translate, type MessageKey } from "../i18n";
import { problemMessage, provincesOn, readCollectionDate, rejectionMessage } from "./form";

describe("readCollectionDate", () => {
  it("reads a day, a month or a year, with the days each one could mean", () => {
    expect(readCollectionDate("day", "2024-01-15")).toEqual({
      value: "2024-01-15",
      first: "2024-01-15",
      last: "2024-01-15",
    });
    expect(readCollectionDate("month", "2024-02")).toEqual({
      value: "2024-02",
      first: "2024-02-01",
      last: "2024-02-29",
    });
    expect(readCollectionDate("month", "2023-02")?.last).toBe("2023-02-28");
    expect(readCollectionDate("month", "2024-12")?.last).toBe("2024-12-31");
    expect(readCollectionDate("year", " 2023 ")).toEqual({ value: "2023", first: "2023-01-01", last: "2023-12-31" });
  });

  it("gives nothing for text that is empty, of another precision, or not a real date", () => {
    for (const [precision, typed] of [
      ["day", ""],
      ["day", "2024-01"],
      ["day", "2024-02-30"],
      ["day", "2024-13-01"],
      ["day", "2024-00-10"],
      ["day", "2024-01-00"],
      ["day", "15/01/2024"],
      ["month", "2024"],
      ["month", "2024-13"],
      ["month", "2024-00"],
      ["month", "2024-01-15"],
      ["year", "24"],
      ["year", "2024-01"],
      ["year", "năm nay"],
    ] as const) {
      expect(readCollectionDate(precision, typed), `${precision} ${typed}`).toBeNull();
    }
  });
});

function unit(code: string, nameVi: string, changes: Partial<AdminUnit> = {}): AdminUnit {
  const old = code.startsWith("vn63:");
  return {
    code,
    level: "province",
    unitSet: old ? "vn63" : "vn34",
    nameVi,
    nameEn: nameVi,
    parentCode: null,
    successorCode: null,
    validFrom: old ? null : "2025-07-01",
    validTo: old ? "2025-06-30" : null,
    ...changes,
  };
}

const UNITS = [
  unit("vn63:ha-noi", "Hà Nội"),
  unit("vn63:an-giang", "An Giang"),
  unit("vn63:dak-lak", "Đắk Lắk"),
  unit("vn34:ha-noi", "Hà Nội"),
  unit("vn34:dak-lak", "Đắk Lắk"),
  unit("vnr:red-river-delta", "Đồng bằng sông Hồng", {
    level: "region",
    unitSet: null,
    validFrom: null,
    validTo: null,
  }),
];
const codes = (precision: "day" | "month" | "year", typed: string) =>
  provincesOn(UNITS, readCollectionDate(precision, typed)!).map((one) => one.code);

describe("provincesOn", () => {
  it("offers the 63 provinces up to 30 June 2025 and the 34 units from 1 July 2025", () => {
    expect(codes("day", "2025-06-30")).toEqual(["vn63:an-giang", "vn63:dak-lak", "vn63:ha-noi"]);
    expect(codes("day", "2025-07-01")).toEqual(["vn34:dak-lak", "vn34:ha-noi"]);
    expect(codes("year", "2019")).toEqual(["vn63:an-giang", "vn63:dak-lak", "vn63:ha-noi"]);
    expect(codes("month", "2026-01")).toEqual(["vn34:dak-lak", "vn34:ha-noi"]);
  });

  it("offers both sets when the date could fall on either side of the merger", () => {
    expect(codes("year", "2025")).toHaveLength(5);
    expect(codes("month", "2025-06")).toHaveLength(3);
    expect(codes("month", "2025-07")).toHaveLength(2);
  });

  it("lists provinces only, in Vietnamese alphabetical order", () => {
    // "Đ" đứng sau "D" và trước "E" trong tiếng Việt, không phải ở cuối bảng như khi xếp theo mã ký tự.
    expect(provincesOn(UNITS, readCollectionDate("year", "2019")!).map((one) => one.nameVi)).toEqual([
      "An Giang",
      "Đắk Lắk",
      "Hà Nội",
    ]);
  });
});

describe("problemMessage and rejectionMessage", () => {
  const SERVER_CODES = [
    "NOT_FASTA",
    "MULTIPLE_SEQUENCES",
    "EMPTY_SEQUENCE",
    "INVALID_CHARACTERS",
    "SEQUENCE_TOO_SHORT",
    "SEQUENCE_TOO_LONG",
    "TOO_FEW_KNOWN_BASES",
    "FASTA_TOO_LARGE",
    "INVALID_NAME",
    "INVALID_DATE",
    "DATE_IN_FUTURE",
    "INVALID_HOST",
    "UNKNOWN_UNIT",
    "UNIT_NOT_VALID_ON_DATE",
  ];

  it("has its own wording, in both languages, for every code the server sends", () => {
    const keys = SERVER_CODES.map((code) => problemMessage(code));
    expect(keys).toEqual(SERVER_CODES.map((code) => `problem_${code}`));
    for (const key of keys) {
      const [vi, en] = [translate("vi", key), translate("en", key)];
      expect(vi.length).toBeGreaterThan(5);
      expect(en).not.toBe(vi);
    }
    expect(new Set(keys.map((key) => translate("vi", key))).size).toBe(keys.length);
  });

  it("falls back to general wording for a code it does not know, or none at all", () => {
    expect(problemMessage("SOMETHING_NEW")).toBe("problem_OTHER");
    expect(problemMessage(undefined)).toBe("problem_OTHER");
    expect(problemMessage("OTHER")).toBe("problem_OTHER");
    expect(problemMessage("constructor")).toBe("problem_OTHER");
  });

  it("explains each reason a sample can be rejected for", () => {
    expect(rejectionMessage("NOT_THIS_PATHOGEN")).toBe("reject_NOT_THIS_PATHOGEN");
    expect(rejectionMessage("TOO_FEW_VALID_SITES")).toBe("reject_TOO_FEW_VALID_SITES");
    expect(rejectionMessage("SOMETHING_NEW")).toBe("reject_OTHER");
    expect(rejectionMessage(null)).toBe("reject_OTHER");
    const keys: MessageKey[] = ["reject_NOT_THIS_PATHOGEN", "reject_TOO_FEW_VALID_SITES", "reject_OTHER"];
    expect(new Set(keys.map((key) => translate("vi", key))).size).toBe(3);
  });
});
