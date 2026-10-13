import { useId, useRef, useState, type FormEvent } from "react";

import { changeFailure, changeProblems, accountProblem, type ChangeField } from "../account/form";
import { ApiError, changePassword } from "../api";
import type { MessageKey } from "../i18n";
import { useAuth } from "../state/auth";
import { useT } from "../state/store";

type Problems = Partial<Record<ChangeField, MessageKey>>;
type Notice = { tone: "good" | "bad"; key: MessageKey };

/** Tài khoản của người đang đăng nhập: email, vai trò, và form đổi mật khẩu. */
export function AccountPage() {
  const t = useT();
  const user = useAuth((state) => state.user);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sending, setSending] = useState(false);
  const ids = { current: useId(), next: useId(), repeat: useId() };
  const summary = useRef<HTMLParagraphElement>(null);

  if (user === undefined) return <main className="page" />;
  if (user === null) {
    return (
      <main className="page">
        <h1>{t("account")}</h1>
        <p>
          {t("adminNeedsLogin")} <a href="#/login">{t("logIn")}</a>
        </p>
      </main>
    );
  }

  const fail = (found: Problems, key: MessageKey) => {
    setProblems(found);
    setNotice({ tone: "bad", key });
    summary.current?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = changeProblems(current, next, repeat);
    if (Object.keys(found).length > 0) return fail(found, "fixPasswordProblems");

    setSending(true);
    setProblems({});
    setNotice(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      setNotice({ tone: "good", key: "passwordChanged" });
      summary.current?.focus();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const detail = error.details.find((one) => one.field === "newPassword");
        fail({ newPassword: accountProblem(detail?.code) }, "fixPasswordProblems");
      } else if (error instanceof ApiError && error.code === "WRONG_PASSWORD") {
        // Mật khẩu vừa gõ không đúng: xoá ô đó để gõ lại.
        setCurrent("");
        fail({ currentPassword: "passwordWrong" }, "fixPasswordProblems");
      } else {
        if (!(error instanceof ApiError)) console.error(error);
        fail({}, error instanceof ApiError ? changeFailure(error.code) : "passwordChangeFailed");
      }
    } finally {
      setSending(false);
    }
  };

  const field = (name: ChangeField, id: string, hint?: MessageKey) => ({
    input: { id, "aria-invalid": problems[name] ? (true as const) : undefined, "aria-describedby": `${id}-note` },
    note: (
      <p id={`${id}-note`} className={problems[name] ? "field__problem" : "hint"}>
        {problems[name] ? t(problems[name]) : hint ? t(hint) : ""}
      </p>
    ),
  });
  const currentField = field("currentPassword", ids.current);
  const nextField = field("newPassword", ids.next, "passwordHint");
  const repeatField = field("repeat", ids.repeat);

  return (
    <main className="page">
      <h1>{t("account")}</h1>
      <dl className="facts">
        <dt>{t("email")}</dt>
        <dd>{user.email}</dd>
        <dt>{t("accountRole")}</dt>
        <dd>{t(user.role === "admin" ? "role_admin" : "role_submitter")}</dd>
      </dl>

      <h2>{t("changePassword")}</h2>
      <p>{t("changePasswordIntro")}</p>
      <form className="form" onSubmit={submit} noValidate>
        <p
          ref={summary}
          tabIndex={-1}
          className={notice ? (notice.tone === "good" ? "notice notice--good" : "notice") : "visually-hidden"}
          role={notice?.tone === "good" ? "status" : "alert"}
        >
          {notice ? t(notice.key) : ""}
        </p>
        {/* Trình quản lý mật khẩu của trình duyệt cần biết mật khẩu này thuộc tài khoản nào. */}
        <input type="text" autoComplete="username" value={user.email} readOnly hidden />

        <div className="field">
          <label htmlFor={ids.current}>{t("currentPassword")}</label>
          <input
            {...currentField.input}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
          {currentField.note}
        </div>
        <div className="field">
          <label htmlFor={ids.next}>{t("newPassword")}</label>
          <input
            {...nextField.input}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          {nextField.note}
        </div>
        <div className="field">
          <label htmlFor={ids.repeat}>{t("repeatPassword")}</label>
          <input
            {...repeatField.input}
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
          {repeatField.note}
        </div>

        <button type="submit" className="button button--primary" disabled={sending}>
          {t(sending ? "changingPassword" : "changePassword")}
        </button>
      </form>
    </main>
  );
}
