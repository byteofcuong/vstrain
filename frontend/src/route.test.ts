import { describe, expect, it } from "vitest";

import { parseRoute } from "./route";

describe("parseRoute", () => {
  it("reads the list, a dataset and the login page from the part of the address after #", () => {
    expect(parseRoute("")).toEqual({ page: "list" });
    expect(parseRoute("#/")).toEqual({ page: "list" });
    expect(parseRoute("#/d/dengue-denv1")).toEqual({ page: "dataset", slug: "dengue-denv1" });
    expect(parseRoute("#/login")).toEqual({ page: "login" });
  });

  it("sends anything else to the list, so no odd text from the address reaches an API call", () => {
    for (const hash of ["#/d/", "#/d/Dengue", "#/d/../etc", "#/d/a b", "#/login/extra", "#/unknown", "#login"]) {
      expect(parseRoute(hash), hash).toEqual({ page: "list" });
    }
  });
});
