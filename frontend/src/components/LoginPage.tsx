import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ApiError } from "../api";
import type { MessageKey } from "../i18n";
import { useAuth } from "../state/auth";
import { useT } from "../state/store";

/** Lời báo cho từng mã lỗi của `POST /api/auth/login`; mã khác (lỗi server, mất mạng) dùng lời chung. */
const FAILURES: Record<string, MessageKey> = {
  INVALID_CREDENTIALS: "loginWrong",
  LOGIN_BUSY: "loginBusy",
  // Lời từ chối của nginx (giới hạn theo địa chỉ IP), không phải của API.
  TOO_MANY_LOGINS: "loginTooMany",
};

export function LoginPage() {
  const t = useT();
  const user = useAuth((state) => state.user);
  const logIn = useAuth((state) => state.logIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const emailId = useId();
  const passwordId = useId();
  const passwordInput = useRef<HTMLInputElement>(null);

  // Đã đăng nhập (vừa xong, hoặc mở trang này khi đang có phiên): về trang danh sách.
  useEffect(() => {
    if (user) window.location.hash = "#/";
  }, [user]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setFailure(null);
    try {
      await logIn(email, password);
    } catch (error) {
      setFailure((error instanceof ApiError && FAILURES[error.code]) || "loginError");
      // Mật khẩu vừa gõ không còn dùng được: xoá và đưa con trỏ về ô đó.
      setPassword("");
      passwordInput.current?.focus();
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="login">
      <h1>{t("logIn")}</h1>
      <p>{t("loginIntro")}</p>
      <form onSubmit={submit}>
        <label htmlFor={emailId}>{t("email")}</label>
        <input
          id={emailId}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor={passwordId}>{t("password")}</label>
        <input
          id={passwordId}
          ref={passwordInput}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {failure && (
          <p className="notice" role="alert">
            {t(failure)}
          </p>
        )}
        <button type="submit" className="button button--primary" disabled={sending}>
          {t(sending ? "loggingIn" : "logIn")}
        </button>
      </form>
      <p className="hint">{t("accountNote")}</p>
    </main>
  );
}
