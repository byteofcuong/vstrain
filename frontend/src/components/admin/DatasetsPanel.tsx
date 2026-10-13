import { useCallback, useEffect, useState } from "react";

import { ApiError, listDatasets, requestBuild, setBuildInterval, type DatasetInfo } from "../../api";
import { adminErrorMessage, intervalLabel, intervalOptions, when } from "../../admin/format";
import type { MessageKey } from "../../i18n";
import { useT, useUi } from "../../state/store";

type Loaded = { state: "loading" } | { state: "ready"; items: DatasetInfo[] } | { state: "error" };
type Notice = { tone: "good" | "bad"; key: MessageKey; values?: Record<string, string | number>; jobs?: boolean };

const OFF = "off";

export function DatasetsPanel() {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoaded({ state: "ready", items: await listDatasets(signal) });
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

  /** Chạy một việc trên một dataset; trong lúc đó các nút của dòng ấy bị khoá để không bấm hai lần. */
  const act = async (dataset: DatasetInfo, action: () => Promise<Notice>) => {
    setNotice(null);
    setWorking(dataset.slug);
    try {
      setNotice(await action());
      await load();
    } catch (error) {
      console.error(error);
      setNotice({ tone: "bad", key: error instanceof ApiError ? adminErrorMessage(error.code) : "actionFailed" });
    } finally {
      setWorking(null);
    }
  };

  const changeSchedule = (dataset: DatasetInfo, value: string) =>
    act(dataset, async () => {
      await setBuildInterval(dataset.slug, value === OFF ? null : Number(value));
      return { tone: "good", key: "scheduleSaved", values: { title: dataset.title } };
    });

  const buildNow = (dataset: DatasetInfo) =>
    act(dataset, async () => {
      const id = await requestBuild(dataset.slug);
      return { tone: "good", key: "buildQueued", values: { id: String(id), title: dataset.title }, jobs: true };
    });

  return (
    <>
      <h1>{t("adminDatasets")}</h1>
      <p>{t("datasetsAdminIntro")}</p>
      {notice && (
        <p className={notice.tone === "good" ? "notice notice--good" : "notice"} role="status">
          {t(notice.key, notice.values)} {notice.jobs && <a href="#/admin/jobs">{t("seeJobs")}</a>}
        </p>
      )}

      {loaded.state === "loading" && <p className="hint">{t("loading")}</p>}
      {loaded.state === "error" && (
        <div className="notice" role="alert">
          <p>{t("loadFailed")}</p>
          <button type="button" onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      )}
      {loaded.state === "ready" && (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">{t("datasetColumn")}</th>
              <th scope="col">{t("currentTree")}</th>
              <th scope="col">{t("schedule")}</th>
              <td />
            </tr>
          </thead>
          <tbody>
            {loaded.items.map((dataset) => {
              const build = dataset.currentBuild;
              return (
                <tr key={dataset.slug} data-dataset={dataset.slug}>
                  <th scope="row">
                    {dataset.title}
                    <small>{dataset.slug}</small>
                  </th>
                  <td>
                    {build?.publishedAt
                      ? t("currentTreeValue", {
                          count: build.sampleCount ?? 0,
                          date: when(build.publishedAt, lang),
                        })
                      : t("notBuiltYet")}
                  </td>
                  <td>
                    <select
                      aria-label={t("scheduleFor", { title: dataset.title })}
                      value={dataset.buildIntervalHours === null ? OFF : String(dataset.buildIntervalHours)}
                      disabled={working === dataset.slug}
                      onChange={(event) => void changeSchedule(dataset, event.target.value)}
                    >
                      <option value={OFF}>{t("scheduleOff")}</option>
                      {intervalOptions(dataset.buildIntervalHours).map((hours) => {
                        const label = intervalLabel(hours);
                        return (
                          <option key={hours} value={hours}>
                            {t(label.key, label.values)}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td className="records__actions">
                    <button
                      type="button"
                      aria-label={`${t("buildNow")}: ${dataset.title}`}
                      disabled={working === dataset.slug}
                      onClick={() => void buildNow(dataset)}
                    >
                      {t("buildNow")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
