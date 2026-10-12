import { useEffect, useState } from "react";

import { DatasetList } from "./components/DatasetList";
import { DatasetView } from "./components/DatasetView";
import type { Lang } from "./i18n";
import { parseRoute } from "./route";
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
  const route = useRoute();

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
        <div className="masthead__lang" role="group" aria-label={t("language")}>
          {LANGUAGES.map(([code, name]) => (
            <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => setLang(code)}>
              {name}
            </button>
          ))}
        </div>
      </header>
      {route.page === "dataset" ? <DatasetView key={route.slug} slug={route.slug} /> : <DatasetList />}
    </div>
  );
}
