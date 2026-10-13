import { describe, expect, it } from "vitest";

import type { AdminUnit } from "../api";
import { MESSAGE_KEYS, translate } from "../i18n";
import {
  adminErrorMessage,
  duration,
  intervalLabel,
  intervalOptions,
  jobKindLabel,
  jobSubject,
  queueIsBusy,
  unitGroups,
} from "./format";

describe("duration", () => {
  it("says how long a job took in the units a person would use", () => {
    expect(duration(0.4, "vi")).toBe("0,4 giây");
    expect(duration(0.4, "en")).toBe("0.4 s");
    expect(duration(9.96, "en")).toBe("10 s");
    expect(duration(31.2, "vi")).toBe("31 giây");
    expect(duration(59.6, "en")).toBe("1 min 00 s");
    expect(duration(412.5, "vi")).toBe("6 phút 53 giây");
    expect(duration(412.5, "en")).toBe("6 min 53 s");
    expect(duration(3725, "vi")).toBe("1 giờ 02 phút");
    expect(duration(3725, "en")).toBe("1 h 02 min");
    expect(duration(0, "en")).toBe("0 s");
  });
});

describe("the build schedule", () => {
  it("names an interval the way a person would", () => {
    expect(intervalLabel(null)).toEqual({ key: "scheduleOff" });
    expect(intervalLabel(24)).toEqual({ key: "scheduleDaily" });
    expect(intervalLabel(168)).toEqual({ key: "scheduleWeekly" });
    expect(intervalLabel(6)).toEqual({ key: "scheduleEveryHours", values: { count: 6 } });
    expect(intervalLabel(72)).toEqual({ key: "scheduleEveryDays", values: { count: 3 } });
    expect(intervalLabel(30)).toEqual({ key: "scheduleEveryHours", values: { count: 30 } });
  });

  it("offers the usual intervals, plus the one a dataset already has when it is unusual", () => {
    expect(intervalOptions(null)).toEqual([6, 12, 24, 72, 168]);
    expect(intervalOptions(24)).toEqual([6, 12, 24, 72, 168]);
    expect(intervalOptions(30)).toEqual([6, 12, 24, 30, 72, 168]);
  });
});

describe("jobs", () => {
  it("has a name in both languages for every kind of job the worker runs", () => {
    const kinds = [
      "align_pending",
      "build_dataset",
      "ingest_sample",
      "place_pending",
      "publish_build",
      "tool_versions",
    ];
    for (const lang of ["vi", "en"] as const) {
      const names = kinds.map((kind) => jobKindLabel(kind, lang));
      expect(new Set(names).size).toBe(kinds.length);
      for (const [index, kind] of kinds.entries()) expect(names[index]).not.toBe(kind);
    }
    // Một loại job mà giao diện chưa biết (server mới hơn) hiện bằng chính tên của nó.
    expect(jobKindLabel("something_new", "vi")).toBe("something_new");
    expect(jobKindLabel("constructor", "vi")).toBe("constructor");
  });

  it("says what a job works on from its parameters", () => {
    expect(jobSubject({ dataset: "dengue-denv1" })).toBe("dengue-denv1");
    expect(jobSubject({ sample_id: 59552 })).toBe("#59552");
    expect(jobSubject({ build_id: 7 })).toBe("build 7");
    expect(jobSubject({ lineage: "denv2" })).toBe("denv2");
    expect(jobSubject({})).toBe("");
    // Tham số lạ không được hiện như HTML hay làm vỡ bảng: chỉ chuỗi ngắn và số được nhận.
    expect(jobSubject({ dataset: { nested: true } })).toBe("");
    expect(jobSubject({ dataset: "x".repeat(200) })).toHaveLength(60);
  });

  it("knows the queue is busy while anything waits or runs", () => {
    expect(queueIsBusy({ queued: 0, running: 0, succeeded: 9, failed: 2 })).toBe(false);
    expect(queueIsBusy({ queued: 1, running: 0, succeeded: 0, failed: 0 })).toBe(true);
    expect(queueIsBusy({ queued: 0, running: 1, succeeded: 0, failed: 0 })).toBe(true);
  });
});

describe("adminErrorMessage", () => {
  it("explains each refusal of the operations API, and falls back for one it does not know", () => {
    const codes = [
      "JOB_NOT_FAILED",
      "JOB_ALREADY_RETRIED",
      "BUILD_ALREADY_WAITING",
      "ALIAS_EXISTS",
      "EMPTY_PLACE",
      "UNKNOWN_UNIT",
      "SEED_ALIAS",
      "FORBIDDEN",
    ];
    const keys = codes.map(adminErrorMessage);
    expect(new Set(keys).size).toBe(codes.length);
    for (const key of keys) expect(MESSAGE_KEYS).toContain(key);
    expect(new Set(keys.map((key) => translate("vi", key))).size).toBe(codes.length);
    expect(adminErrorMessage("SOMETHING_NEW")).toBe("actionFailed");
    expect(adminErrorMessage("toString")).toBe("actionFailed");
  });
});

describe("unitGroups", () => {
  const unit = (code: string, level: AdminUnit["level"], unitSet: AdminUnit["unitSet"], nameVi: string): AdminUnit => ({
    code,
    level,
    unitSet,
    nameVi,
    nameEn: nameVi.replaceAll("Đ", "D").replaceAll("đ", "d").normalize("NFD").replace(/\p{M}/gu, ""),
    parentCode: null,
    successorCode: null,
    validFrom: null,
    validTo: null,
  });
  const units = [
    unit("vnm:south", "macro_region", null, "Miền Nam"),
    unit("vn34:ha-noi", "province", "vn34", "Hà Nội"),
    unit("vn63:dong-nai", "province", "vn63", "Đồng Nai"),
    unit("vnr:southeast", "region", null, "Đông Nam Bộ"),
    unit("vn63:an-giang", "province", "vn63", "An Giang"),
    unit("vn63:ha-noi", "province", "vn63", "Hà Nội"),
  ];

  it("groups the units a spelling can be mapped to, most specific first, sorted the Vietnamese way", () => {
    const groups = unitGroups(units, "vi");

    expect(groups.map((group) => group.label)).toEqual(["unitsOf63", "unitsOf34", "unitsRegions", "unitsMacroRegions"]);
    // Đ đứng sau D trong bảng chữ cái tiếng Việt, không lẫn vào giữa các tên bắt đầu bằng D.
    expect(groups[0].units.map((one) => one.name)).toEqual(["An Giang", "Đồng Nai", "Hà Nội"]);
    expect(groups[1].units).toEqual([{ code: "vn34:ha-noi", name: "Hà Nội" }]);
    expect(groups[2].units).toEqual([{ code: "vnr:southeast", name: "Đông Nam Bộ" }]);
    expect(groups[3].units).toEqual([{ code: "vnm:south", name: "Miền Nam" }]);
  });

  it("uses the English names in English, and leaves out a group with nothing in it", () => {
    const groups = unitGroups(units.slice(1, 3), "en");

    expect(groups.map((group) => group.label)).toEqual(["unitsOf63", "unitsOf34"]);
    expect(groups[0].units).toEqual([{ code: "vn63:dong-nai", name: "Dong Nai" }]);
  });
});
