import { useEffect, useState } from "react";

import { DatasetList } from "./components/DatasetList";
import { DatasetView } from "./components/DatasetView";
import { LoginPage } from "./components/LoginPage";
import { MySamplesPage } from "./components/MySamplesPage";
import { SubmitPage } from "./components/SubmitPage";
import type { Lang } from "./i18n";
import { parseRoute } from "./route";
import { useAuth } from "./state/auth";
import { useT, useUi } from "./state/store";

function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}

const LANGUAGES: [Lang, string][] = [
  ["vi", "Tiếng Việt"],
  ["en", "English"],
];

export function App() {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const setLang = useUi((state) => state.setLang);
  const user = useAuth((state) => state.user);
  const refreshUser = useAuth((state) => state.refresh);
  const logOut = useAuth((state) => state.logOut);
  const route = useRoute();

  // Trang vừa mở: hỏi server xem cookie hiện có còn ứng với một phiên đăng nhập không.
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${t("appName")}: ${t("appTagline")}`;
  }, [lang, t]);

  return (
    <div className={route.page === "dataset" ? "app app--workspace" : "app"}>
      <header className="masthead">
        <a className="masthead__name" href="#/">
          {t("appName")}
        </a>
        <span className="masthead__tagline">{t("appTagline")}</span>
        {route.page === "dataset" && (
          <a className="masthead__back" href="#/">
            {t("backToDatasets")}
          </a>
        )}
        <div className="masthead__end">
          {/* Chưa biết ai đang dùng (đang hỏi server) thì chưa hiện gì, để nút không nhấp nháy lúc mở trang. */}
          {user === null && route.page !== "login" && (
            <a className="masthead__account" href="#/login">
              {t("logIn")}
            </a>
          )}
          {user && (
            <nav className="masthead__nav" aria-label={t("submitSample")}>
              <a href="#/submit" aria-current={route.page === "submit" ? "page" : undefined}>
                {t("submitSample")}
              </a>
              <a href="#/mine" aria-current={route.page === "mine" ? "page" : undefined}>
                {t("mySamples")}
              </a>
            </nav>
          )}
          {user && (
            <span className="masthead__account">
              <span>{user.displayName}</span>
              {/* Đăng xuất không thành thì phiên còn sống ở server: tên vẫn hiện, để không ai tưởng mình đã ra. */}
              <button type="button" onClick={() => void logOut().catch((error: unknown) => console.error(error))}>
                {t("logOut")}
              </button>
            </span>
          )}
          <div className="masthead__lang" role="group" aria-label={t("language")}>
            {LANGUAGES.map(([code, name]) => (
              <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => setLang(code)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </header>
      {route.page === "dataset" && <DatasetView key={route.slug} slug={route.slug} tip={route.tip} />}
      {route.page === "login" && <LoginPage />}
      {route.page === "submit" && <SubmitPage />}
      {route.page === "mine" && <MySamplesPage />}
      {route.page === "list" && <DatasetList />}
    </div>
  );
}
