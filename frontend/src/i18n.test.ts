import { describe, expect, it } from "vitest";

import { formatNumber, MESSAGE_KEYS, translate } from "./i18n";
import { parseRoute } from "./route";

describe("translate", () => {
  it("has a non-empty text in both languages for every message", () => {
    for (const key of MESSAGE_KEYS) {
      expect(translate("vi", key).trim(), key).not.toBe("");
      expect(translate("en", key).trim(), key).not.toBe("");
    }
  });

  it("uses the same placeholders in both languages of a message", () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of MESSAGE_KEYS) {
      expect(placeholders(translate("en", key)), key).toEqual(placeholders(translate("vi", key)));
    }
  });

  it("fills in values and writes numbers the way each language does", () => {
    expect(translate("vi", "showing", { shown: 1489, total: 1964 })).toBe("Đang hiện 1.489 trong 1.964 mẫu");
    expect(translate("en", "showing", { shown: 1489, total: 1964 })).toBe("Showing 1,489 of 1,964 samples");
    expect(formatNumber("vi", 35000)).toBe("35.000");
  });

  it("inserts text values as they are, without interpreting them", () => {
    expect(translate("en", "removeFilter", { column: "{count} <b>$&" })).toBe("Remove the {count} <b>$& filter");
  });

  it("leaves a placeholder in place when no value is given for it", () => {
    expect(translate("en", "samplesInTree")).toBe("{count} samples in the tree");
  });
});

describe("parseRoute", () => {
  it("reads the dataset slug from the fragment of the URL", () => {
    expect(parseRoute("#/d/dengue-denv1")).toEqual({ page: "dataset", slug: "dengue-denv1" });
    expect(parseRoute("#/d/synth-35000")).toEqual({ page: "dataset", slug: "synth-35000" });
  });

  it.each([
    "",
    "#",
    "#/",
    "#/d/",
    "#/d/Dengue",
    "#/d/-denv1",
    "#/d/a/b",
    "#/d/a%2Fb",
    "#/d/../api",
    "#/d/a?x=1",
    "#/x/denv1",
    `#/d/${"a".repeat(101)}`,
  ])("shows the dataset list for %j", (hash) => {
    expect(parseRoute(hash)).toEqual({ page: "list" });
  });
});
