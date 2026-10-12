import { useEffect, useState } from "react";

import { listDatasets, type DatasetInfo } from "../api";
import { useT, useUi } from "../state/store";

type State = { state: "loading" } | { state: "ready"; datasets: DatasetInfo[] } | { state: "failed"; message: string };

export function DatasetList() {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const [state, setState] = useState<State>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ state: "loading" });
    listDatasets(controller.signal)
      .then((datasets) => setState({ state: "ready", datasets }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ state: "failed", message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => controller.abort();
  }, [attempt]);

  const day = new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { dateStyle: "medium" });

  return (
    <main className="catalogue">
      <header>
        <h1>{t("datasets")}</h1>
        <p>{t("datasetsIntro")}</p>
      </header>

      {state.state === "loading" && <p className="hint">{t("loading")}</p>}
      {state.state === "failed" && (
        <div className="message">
          <p>
            {t("loadFailed")}: {state.message}
          </p>
          <button type="button" onClick={() => setAttempt((count) => count + 1)}>
            {t("retry")}
          </button>
        </div>
      )}
      {state.state === "ready" && state.datasets.length === 0 && <p className="hint">{t("noDatasets")}</p>}
      {state.state === "ready" && state.datasets.length > 0 && (
        <ul className="catalogue__list">
          {state.datasets.map((dataset) => {
            const build = dataset.currentBuild;
            return (
              <li key={dataset.slug} className={build ? undefined : "is-empty"}>
                <div>
                  <h2>{build ? <a href={`#/d/${dataset.slug}`}>{dataset.title}</a> : dataset.title}</h2>
                  <p>
                    {build
                      ? [
                          t("samplesInTree", { count: build.sampleCount ?? 0 }),
                          build.publishedAt
                            ? t("publishedOn", { date: day.format(new Date(build.publishedAt)) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(", ")
                      : t("notBuiltYet")}
                  </p>
                </div>
                {build && (
                  <a className="button" href={`#/d/${dataset.slug}`} aria-label={`${t("openTree")}: ${dataset.title}`}>
                    {t("openTree")}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
