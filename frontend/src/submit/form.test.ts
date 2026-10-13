import { describe, expect, it } from "vitest";

import type { AdminUnit, SubmissionStage } from "../api";
import { translate, type MessageKey } from "../i18n";
import {
  canCorrect,
  correctionMessage,
  limitMessage,
  problemMessage,
  provincesOn,
  readCollectionDate,
  rejectionMessage,
  typedDate,
} from "./form";

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

  it("tells waiting a moment from waiting until tomorrow when the server takes no more samples", () => {
    expect(limitMessage("TOO_MANY_PENDING")).toBe("submitTooMany");
    expect(limitMessage("TOO_MANY_TODAY")).toBe("submitTooManyToday");
    // Một trần mà giao diện chưa biết: lời khuyên chờ rồi nộp lại vẫn đúng.
    expect(limitMessage("SOMETHING_NEW")).toBe("submitTooMany");
    expect(translate("vi", "submitTooManyToday")).not.toBe(translate("vi", "submitTooMany"));
  });

  it("has words for every stage a submitted sample can be in", () => {
    const stages: SubmissionStage[] = [
      "processing",
      "failed",
      "rejected",
      "hidden",
      "accepted",
      "placement_failed",
      "placed",
      "in_tree",
    ];
    for (const lang of ["vi", "en"] as const) {
      const words = stages.map((stage) => translate(lang, `stage_${stage}`));
      expect(new Set(words).size).toBe(stages.length);
    }
  });
});

describe("typedDate", () => {
  it("turns a stored collection date back into what the form holds, at the precision the lab gave", () => {
    expect(typedDate("2024-01-15")).toEqual({ precision: "day", text: "2024-01-15" });
    expect(typedDate("2024-01-XX")).toEqual({ precision: "month", text: "2024-01" });
    expect(typedDate("2024-XX-XX")).toEqual({ precision: "year", text: "2024" });
  });

  it("gives back a date the form reads as the same stored value", () => {
    for (const stored of ["2024-02-29", "2023-12-XX", "1999-XX-XX"]) {
      const typed = typedDate(stored);
      expect(typed).not.toBeNull();
      if (typed) expect(readCollectionDate(typed.precision, typed.text)?.value).toBe(typed.text);
    }
  });

  it("gives nothing for a date that is missing or in a shape the form cannot hold", () => {
    for (const stored of [null, "", "XXXX-XX-XX", "2024-XX-15", "15/01/2024", "2024", "2024-01-15T00:00"]) {
      expect(typedDate(stored), String(stored)).toBeNull();
    }
  });
});

describe("canCorrect", () => {
  it("lets a lab correct a sample once it is accepted and nothing is still running for it", () => {
    const yes: SubmissionStage[] = ["accepted", "placement_failed", "placed", "in_tree"];
    const no: SubmissionStage[] = ["processing", "failed", "rejected", "hidden"];
    for (const stage of yes) expect(canCorrect({ status: "accepted", stage }), stage).toBe(true);
    for (const stage of no)
      expect(canCorrect({ status: stage === "processing" ? "accepted" : stage, stage })).toBe(false);
    // Tình trạng mà giao diện chưa biết (server mới hơn): không mời sửa thứ chưa chắc sửa được.
    expect(canCorrect({ status: "accepted", stage: "something_new" as SubmissionStage })).toBe(false);
  });
});

describe("correctionMessage", () => {
  it("says why a correction was not taken, in words of its own for each reason", () => {
    const keys = ["SAMPLE_BEING_CHECKED", "SAMPLE_NOT_EDITABLE", "SUBMISSION_NOT_FOUND", "FORBIDDEN"].map(
      correctionMessage,
    );
    expect(new Set(keys).size).toBe(4);
    expect(keys).not.toContain("editFailed");
    for (const lang of ["vi", "en"] as const) {
      expect(new Set(keys.map((key) => translate(lang, key))).size).toBe(4);
    }
    expect(correctionMessage("SOMETHING_NEW")).toBe("editFailed");
    expect(correctionMessage("constructor")).toBe("editFailed");
  });
});
