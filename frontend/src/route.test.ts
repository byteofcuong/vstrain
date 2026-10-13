import { describe, expect, it } from "vitest";

import { parseRoute } from "./route";

describe("parseRoute", () => {
  it("reads each page from the part of the address after #", () => {
    expect(parseRoute("")).toEqual({ page: "list" });
    expect(parseRoute("#/")).toEqual({ page: "list" });
    expect(parseRoute("#/d/dengue-denv1")).toEqual({ page: "dataset", slug: "dengue-denv1", tip: null });
    expect(parseRoute("#/login")).toEqual({ page: "login" });
    expect(parseRoute("#/submit")).toEqual({ page: "submit" });
    expect(parseRoute("#/mine")).toEqual({ page: "mine" });
    expect(parseRoute("#/mine/S0059552/edit")).toEqual({ page: "editSample", internalId: "S0059552" });
    expect(parseRoute("#/admin/jobs")).toEqual({ page: "admin", section: "jobs" });
    expect(parseRoute("#/admin/datasets")).toEqual({ page: "admin", section: "datasets" });
    expect(parseRoute("#/admin/places")).toEqual({ page: "admin", section: "places" });
    expect(parseRoute("#/admin/users")).toEqual({ page: "admin", section: "users" });
    expect(parseRoute("#/account")).toEqual({ page: "account" });
  });

  it("reads the provisional tip a dataset address points at", () => {
    expect(parseRoute("#/d/dengue-denv1/t/S0059552")).toEqual({
      page: "dataset",
      slug: "dengue-denv1",
      tip: "S0059552",
    });
  });

  it("sends anything else to the list, so no odd text from the address reaches an API call", () => {
    for (const hash of [
      "#/d/",
      "#/d/Dengue",
      "#/d/../etc",
      "#/d/a b",
      "#/login/extra",
      "#/unknown",
      "#login",
      "#/submit/",
      "#/mine?all",
      "#/mine/S0059552",
      "#/mine/S123/edit",
      "#/mine/abc/edit",
      "#/mine/S0059552/edit/",
      "#/mine/S0059552/delete",
      "#/d/dengue-denv1/t/",
      "#/d/dengue-denv1/t/abc",
      "#/d/dengue-denv1/t/S123",
      "#/d/dengue-denv1/t/S0059552/extra",
      "#/d/dengue-denv1/x/S0059552",
      "#/constructor",
      "#/toString",
      "#/admin",
      "#/admin/",
      "#/admin/accounts",
      "#/account/",
      "#/account/password",
      "#/admin/jobs/7",
    ]) {
      expect(parseRoute(hash), hash).toEqual({ page: "list" });
    }
  });
});
