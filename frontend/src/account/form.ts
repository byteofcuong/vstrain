import type { MessageKey } from "../i18n";

/**
 * Phần logic của form đổi mật khẩu và form tạo tài khoản, tách khỏi giao diện để thử được. Server kiểm tra lại mọi
 * thứ; phần này để form nói chỗ sai trước khi gửi.
 */

const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200;

/** Cùng một mật khẩu tiếng Việt gõ bằng hai bộ gõ (chữ dựng sẵn, dấu rời) là một: server chuẩn hoá NFKC, ở đây cũng vậy. */
const normalized = (password: string) => password.normalize("NFKC");

/** Mật khẩu có độ dài server nhận không (10 tới 200 ký tự sau chuẩn hoá). */
export function passwordFits(password: string): boolean {
  const length = normalized(password).length;
  return length >= MIN_PASSWORD && length <= MAX_PASSWORD;
}

export type ChangeField = "currentPassword" | "newPassword" | "repeat";

/** Những chỗ của form đổi mật khẩu cần sửa trước khi gửi. */
export function changeProblems(
  current: string,
  next: string,
  repeat: string,
): Partial<Record<ChangeField, MessageKey>> {
  const found: Partial<Record<ChangeField, MessageKey>> = {};
  if (current === "") found.currentPassword = "passwordCurrentMissing";
  if (!passwordFits(next)) found.newPassword = "accountProblem_WEAK_PASSWORD";
  else if (normalized(next) === normalized(current)) found.newPassword = "accountProblem_SAME_PASSWORD";
  if (repeat !== next) found.repeat = "passwordRepeatDiffers";
  return found;
}

const CHANGE_FAILURES: ReadonlyMap<string, MessageKey> = new Map([
  ["WRONG_PASSWORD", "passwordWrong"],
  ["TOO_MANY_ATTEMPTS", "passwordTooManyAttempts"],
  ["LOGIN_BUSY", "loginBusy"],
]);

/** Lời báo khi server không đổi mật khẩu; mã chưa biết dùng lời chung. */
export function changeFailure(code: string): MessageKey {
  return CHANGE_FAILURES.get(code) ?? "passwordChangeFailed";
}

const ACCOUNT_PROBLEMS: ReadonlyMap<string, MessageKey> = new Map([
  ["INVALID_EMAIL", "accountProblem_INVALID_EMAIL"],
  ["INVALID_NAME", "accountProblem_INVALID_NAME"],
  ["UNKNOWN_ROLE", "accountProblem_UNKNOWN_ROLE"],
  ["WEAK_PASSWORD", "accountProblem_WEAK_PASSWORD"],
  ["SAME_PASSWORD", "accountProblem_SAME_PASSWORD"],
]);

/** Lời báo cho một trường của tài khoản mà server không nhận; mã chưa biết dùng lời chung. */
export function accountProblem(code: string | undefined): MessageKey {
  return (code !== undefined && ACCOUNT_PROBLEMS.get(code)) || "accountProblem_OTHER";
}
