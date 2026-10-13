import { describe, expect, it } from "vitest";

import { MESSAGE_KEYS, translate } from "../i18n";
import { accountProblem, changeFailure, changeProblems, passwordFits } from "./form";

describe("passwordFits", () => {
  it("takes 10 to 200 characters, counted the way the server counts them", () => {
    expect(passwordFits("123456789")).toBe(false);
    expect(passwordFits("1234567890")).toBe(true);
    expect(passwordFits("x".repeat(200))).toBe(true);
    expect(passwordFits("x".repeat(201))).toBe(false);
    expect(passwordFits("")).toBe(false);
  });

  it("counts a Vietnamese password the same whichever way its accents were typed", () => {
    const composed = "mật khẩu á";
    const decomposed = composed.normalize("NFD");
    expect(decomposed.length).toBeGreaterThan(composed.length);
    expect(composed.length).toBe(10);
    expect(passwordFits(composed)).toBe(true);
    expect(passwordFits(decomposed)).toBe(true);
    // Chín chữ có dấu gõ kiểu dấu rời dài hơn mười ký tự thô, nhưng vẫn chỉ là chín chữ.
    const nine = "mật khẩu ".normalize("NFD");
    expect(nine.length).toBeGreaterThanOrEqual(10);
    expect(passwordFits(nine)).toBe(false);
  });
});

describe("changeProblems", () => {
  const good = "một mật khẩu mới";

  it("finds nothing wrong with a current password, a fitting new one and the same one repeated", () => {
    expect(changeProblems("mật khẩu đang dùng", good, good)).toEqual({});
  });

  it("names each field that needs fixing before anything is sent", () => {
    expect(changeProblems("", "ngắn", "khác")).toEqual({
      currentPassword: "passwordCurrentMissing",
      newPassword: "accountProblem_WEAK_PASSWORD",
      repeat: "passwordRepeatDiffers",
    });
    expect(changeProblems("mật khẩu đang dùng", good, good + " ")).toEqual({ repeat: "passwordRepeatDiffers" });
  });

  it("refuses a new password that is the current one, however its accents were typed", () => {
    const current = "mật khẩu đang dùng";
    expect(changeProblems(current, current, current)).toEqual({ newPassword: "accountProblem_SAME_PASSWORD" });
    const retyped = current.normalize("NFD");
    expect(changeProblems(current, retyped, retyped)).toEqual({ newPassword: "accountProblem_SAME_PASSWORD" });
  });
});

describe("changeFailure and accountProblem", () => {
  it("has words of its own for each way the server refuses a password change", () => {
    const keys = ["WRONG_PASSWORD", "TOO_MANY_ATTEMPTS", "LOGIN_BUSY"].map(changeFailure);
    expect(new Set(keys).size).toBe(3);
    expect(keys).not.toContain("passwordChangeFailed");
    for (const lang of ["vi", "en"] as const) expect(new Set(keys.map((key) => translate(lang, key))).size).toBe(3);
    expect(changeFailure("SOMETHING_NEW")).toBe("passwordChangeFailed");
    expect(changeFailure("constructor")).toBe("passwordChangeFailed");
  });

  it("has words of its own for each problem of an account field", () => {
    const codes = ["INVALID_EMAIL", "INVALID_NAME", "UNKNOWN_ROLE", "WEAK_PASSWORD", "SAME_PASSWORD"];
    const keys = codes.map(accountProblem);
    expect(new Set(keys).size).toBe(codes.length);
    expect(keys).not.toContain("accountProblem_OTHER");
    for (const key of keys) expect(MESSAGE_KEYS).toContain(key);
    for (const lang of ["vi", "en"] as const) {
      expect(new Set(keys.map((key) => translate(lang, key))).size).toBe(codes.length);
    }
    expect(accountProblem("SOMETHING_NEW")).toBe("accountProblem_OTHER");
    expect(accountProblem(undefined)).toBe("accountProblem_OTHER");
    expect(accountProblem("toString")).toBe("accountProblem_OTHER");
  });
});
