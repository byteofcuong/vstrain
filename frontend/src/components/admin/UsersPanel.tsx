import { useCallback, useEffect, useId, useState, type FormEvent } from "react";

import { accountProblem, passwordFits } from "../../account/form";
import { adminErrorMessage, when } from "../../admin/format";
import {
  ApiError,
  createAccount,
  listAccounts,
  resetAccountPassword,
  setAccountLocked,
  type Account,
  type AccountInput,
} from "../../api";
import type { MessageKey } from "../../i18n";
import { useAuth } from "../../state/auth";
import { useT, useUi } from "../../state/store";

type Loaded = { state: "loading" } | { state: "ready"; accounts: Account[] } | { state: "error" };
type Notice = { tone: "bad"; key: MessageKey } | { tone: "good"; key: MessageKey; email: string };
type AccountField = "email" | "displayName" | "role" | "password";
type Problems = Partial<Record<AccountField, MessageKey>>;

const ACCOUNT_FIELDS: readonly AccountField[] = ["email", "displayName", "role", "password"];
const EMPTY: AccountInput = { email: "", displayName: "", role: "submitter", password: "" };

/** Lời báo cho một lần API từ chối: lời riêng của mã đó, hoặc lời chung. */
const refusal = (error: unknown): MessageKey =>
  error instanceof ApiError ? adminErrorMessage(error.code) : "actionFailed";

/** Tài khoản: danh sách, khoá và mở khoá, đặt lại mật khẩu, tạo mới. */
export function UsersPanel() {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const me = useAuth((state) => state.user);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [working, setWorking] = useState(false);
  /** Tài khoản đang được đặt lại mật khẩu (form hiện ngay dưới dòng của nó), và mật khẩu đang gõ. */
  const [resetting, setResetting] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetProblem, setResetProblem] = useState<MessageKey | null>(null);
  const [draft, setDraft] = useState<AccountInput>(EMPTY);
  const [problems, setProblems] = useState<Problems>({});
  const ids = { email: useId(), name: useId(), role: useId(), password: useId(), reset: useId() };

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoaded({ state: "ready", accounts: await listAccounts(signal) });
    } catch (error) {
      if (signal?.aborted) return;
      console.error(error);
      setLoaded({ state: "error" });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /** Chạy một việc ghi rồi tải lại danh sách; lời báo thành công chỉ hiện khi việc đó xong. */
  const act = async (work: () => Promise<void>, done: Notice): Promise<boolean> => {
    setWorking(true);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      await load();
      return true;
    } catch (error) {
      if (!(error instanceof ApiError)) console.error(error);
      setNotice({ tone: "bad", key: refusal(error) });
      return false;
    } finally {
      setWorking(false);
    }
  };

  const setLocked = (account: Account, locked: boolean) =>
    act(() => setAccountLocked(account.id, locked), {
      tone: "good",
      key: locked ? "accountLockedNotice" : "accountUnlockedNotice",
      email: account.email,
    });

  const startReset = (account: Account | null) => {
    setResetting(account?.id ?? null);
    setResetPassword("");
    setResetProblem(null);
  };

  const reset = async (event: FormEvent, account: Account) => {
    event.preventDefault();
    if (!passwordFits(resetPassword)) return setResetProblem("accountProblem_WEAK_PASSWORD");
    const done = await act(() => resetAccountPassword(account.id, resetPassword), {
      tone: "good",
      key: "passwordResetNotice",
      email: account.email,
    });
    if (done) startReset(null);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const found: Problems = {};
    if (!draft.email.includes("@")) found.email = "accountProblem_INVALID_EMAIL";
    if (draft.displayName.trim() === "") found.displayName = "accountProblem_INVALID_NAME";
    if (!passwordFits(draft.password)) found.password = "accountProblem_WEAK_PASSWORD";
    setProblems(found);
    if (Object.keys(found).length > 0) return setNotice({ tone: "bad", key: "fixAccountProblems" });

    setWorking(true);
    setNotice(null);
    try {
      const created = await createAccount(draft);
      setDraft(EMPTY);
      setNotice({ tone: "good", key: "accountCreatedNotice", email: created.email });
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const fromServer: Problems = {};
        for (const detail of error.details) {
          const field = ACCOUNT_FIELDS.find((one) => one === detail.field);
          if (field && !fromServer[field]) fromServer[field] = accountProblem(detail.code);
        }
        setProblems(fromServer);
        setNotice({ tone: "bad", key: "fixAccountProblems" });
      } else {
        if (!(error instanceof ApiError)) console.error(error);
        setNotice({ tone: "bad", key: refusal(error) });
      }
    } finally {
      setWorking(false);
    }
  };

  const field = (name: AccountField, id: string, hint?: MessageKey) => ({
    input: { id, "aria-invalid": problems[name] ? (true as const) : undefined, "aria-describedby": `${id}-note` },
    note: (
      <p id={`${id}-note`} className={problems[name] ? "field__problem" : "hint"}>
        {problems[name] ? t(problems[name]) : hint ? t(hint) : ""}
      </p>
    ),
  });
  const emailField = field("email", ids.email);
  const nameField = field("displayName", ids.name);
  const roleField = field("role", ids.role);
  const passwordField = field("password", ids.password, "initialPasswordHint");

  return (
    <>
      <h1>{t("adminUsers")}</h1>
      <p>{t("usersIntro")}</p>
      {notice && (
        <p
          className={notice.tone === "good" ? "notice notice--good" : "notice"}
          role={notice.tone === "good" ? "status" : "alert"}
        >
          {notice.tone === "good" ? t(notice.key, { email: notice.email }) : t(notice.key)}
        </p>
      )}

      {loaded.state === "loading" && <p className="hint">{t("loading")}</p>}
      {loaded.state === "error" && (
        <div className="notice" role="alert">
          <p>{t("usersFailed")}</p>
          <button type="button" onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      )}
      {loaded.state === "ready" && (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">{t("accountName")}</th>
              <th scope="col">{t("email")}</th>
              <th scope="col">{t("accountRole")}</th>
              <th scope="col">{t("accountState")}</th>
              <th scope="col">{t("accountSince")}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {loaded.accounts.map((account) => {
              const mine = account.email === me?.email;
              return (
                <tr key={account.id} data-locked={account.isLocked}>
                  <th scope="row">
                    {account.displayName}
                    {mine && <small>{t("accountIsYou")}</small>}
                  </th>
                  <td>{account.email}</td>
                  <td>{t(account.role === "admin" ? "role_admin" : "role_submitter")}</td>
                  <td>{t(account.isLocked ? "accountLocked" : "accountActive")}</td>
                  <td>{when(account.createdAt, lang)}</td>
                  <td>
                    {/* Tài khoản của chính mình: không tự khoá được, và mật khẩu đổi ở trang Tài khoản. */}
                    {mine ? (
                      <a href="#/account">{t("changePassword")}</a>
                    ) : resetting === account.id ? (
                      <form className="inline-form" onSubmit={(event) => void reset(event, account)}>
                        <label htmlFor={ids.reset}>{t("newPasswordFor", { email: account.email })}</label>
                        <input
                          id={ids.reset}
                          type="password"
                          autoComplete="new-password"
                          aria-invalid={resetProblem ? true : undefined}
                          aria-describedby={`${ids.reset}-note`}
                          value={resetPassword}
                          onChange={(event) => setResetPassword(event.target.value)}
                        />
                        <p id={`${ids.reset}-note`} className={resetProblem ? "field__problem" : "hint"}>
                          {t(resetProblem ?? "initialPasswordHint")}
                        </p>
                        <button type="submit" disabled={working}>
                          {t("setPassword")}
                        </button>{" "}
                        <button type="button" className="quiet" onClick={() => startReset(null)}>
                          {t("cancel")}
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => void setLocked(account, !account.isLocked)}
                        >
                          {t(account.isLocked ? "unlockAccount" : "lockAccount")}
                        </button>{" "}
                        <button type="button" className="quiet" disabled={working} onClick={() => startReset(account)}>
                          {t("resetPassword")}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>{t("createAccount")}</h2>
      <form className="form" onSubmit={(event) => void create(event)} noValidate>
        <div className="field">
          <label htmlFor={ids.email}>{t("email")}</label>
          <input
            {...emailField.input}
            type="email"
            autoComplete="off"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
          {emailField.note}
        </div>
        <div className="field">
          <label htmlFor={ids.name}>{t("displayName")}</label>
          <input
            {...nameField.input}
            type="text"
            maxLength={100}
            autoComplete="off"
            value={draft.displayName}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
          />
          {nameField.note}
        </div>
        <div className="field">
          <label htmlFor={ids.role}>{t("accountRole")}</label>
          <select
            {...roleField.input}
            value={draft.role}
            onChange={(event) => setDraft({ ...draft, role: event.target.value === "admin" ? "admin" : "submitter" })}
          >
            <option value="submitter">{t("role_submitter")}</option>
            <option value="admin">{t("role_admin")}</option>
          </select>
          {roleField.note}
        </div>
        <div className="field">
          <label htmlFor={ids.password}>{t("initialPassword")}</label>
          <input
            {...passwordField.input}
            type="password"
            autoComplete="new-password"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
          />
          {passwordField.note}
        </div>
        <button type="submit" className="button button--primary" disabled={working}>
          {t("createAccount")}
        </button>
      </form>
    </>
  );
}
