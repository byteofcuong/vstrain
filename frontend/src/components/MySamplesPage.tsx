import { useCallback, useEffect, useRef, useState } from "react";

import { listSubmissions, setSampleHidden, type Submission } from "../api";
import { unitName, useProvinces } from "../data/provinces";
import { useAuth } from "../state/auth";
import { useT, useUi } from "../state/store";
import { useSubmissions } from "../state/submissions";
import { canCorrect, rejectionMessage } from "../submit/form";
import { Choice } from "./Choice";

type Scope = "mine" | "all";
type Loaded = { state: "loading" } | { state: "ready"; items: Submission[] } | { state: "error" };

/** Trong lúc còn mẫu đang được kiểm tra, danh sách tự tải lại theo nhịp này, nhiều nhất bấy nhiêu lần. */
const REFRESH_MILLISECONDS = 1000;
const REFRESH_LIMIT = 120;

function when(iso: string, lang: "vi" | "en"): string {
  return new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function MySamplesPage() {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const user = useAuth((state) => state.user);
  // Lời báo "đã nhận mẫu" chỉ dành cho lần mở trang ngay sau khi nộp: đọc một lần rồi xoá khỏi store.
  const [justSubmitted] = useState(() => useSubmissions.getState().justSubmitted);
  const [justCorrected] = useState(() => useSubmissions.getState().justCorrected);
  const provinces = useProvinces();
  const [scope, setScope] = useState<Scope>("mine");
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [actionFailed, setActionFailed] = useState(false);
  const refreshes = useRef(0);
  const loggedIn = Boolean(user);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await listSubmissions(scope, signal);
        setLoaded({ state: "ready", items: page.items });
      } catch (error) {
        if (signal?.aborted) return;
        console.error(error);
        setLoaded({ state: "error" });
      }
    },
    [scope],
  );

  useEffect(() => {
    if (!loggedIn) return;
    const controller = new AbortController();
    refreshes.current = 0;
    setLoaded({ state: "loading" });
    void load(controller.signal);
    return () => controller.abort();
  }, [loggedIn, load]);

  // Việc kiểm tra một mẫu mất vài giây: tự tải lại cho tới khi không còn mẫu nào đang được kiểm tra.
  const checking = loaded.state === "ready" && loaded.items.some((item) => item.stage === "processing");
  useEffect(() => {
    if (!checking || refreshes.current >= REFRESH_LIMIT) return;
    const timer = window.setTimeout(() => {
      refreshes.current += 1;
      void load();
    }, REFRESH_MILLISECONDS);
    return () => window.clearTimeout(timer);
  }, [checking, loaded, load]);

  useEffect(() => {
    useSubmissions.getState().setJustSubmitted(null);
    useSubmissions.getState().setJustCorrected(null);
  }, []);

  if (user === undefined) return <main className="page" />;
  if (user === null) {
    return (
      <main className="page">
        <h1>{t("mySamples")}</h1>
        <p>
          {t("submitNeedsLogin")} <a href="#/login">{t("logIn")}</a>
        </p>
      </main>
    );
  }

  const admin = user.role === "admin";
  const everyone = admin && scope === "all";

  const setHidden = async (item: Submission, hidden: boolean) => {
    setActionFailed(false);
    try {
      await setSampleHidden(item.internalId, hidden);
      await load();
    } catch (error) {
      console.error(error);
      setActionFailed(true);
    }
  };

  return (
    <main className="page page--wide">
      <h1>{t(everyone ? "allSubmissions" : "mySamples")}</h1>
      <p>
        {t(everyone ? "allSubmissionsIntro" : "mySamplesIntro")} <a href="#/submit">{t("submitSample")}</a>
      </p>
      {admin && (
        <Choice<Scope>
          legend={t("submissionsShown")}
          value={scope}
          options={[
            ["mine", t("onlyMine")],
            ["all", t("allSubmissions")],
          ]}
          onChange={setScope}
        />
      )}
      {justSubmitted !== null && (
        <p className="notice notice--good" role="status">
          {t("submittedNotice", { name: justSubmitted })}
        </p>
      )}
      {justCorrected !== null && (
        <p className="notice notice--good" role="status">
          {t("correctedNotice", { name: justCorrected })}
        </p>
      )}
      {actionFailed && (
        <p className="notice" role="alert">
          {t("actionFailed")}
        </p>
      )}

      {loaded.state === "loading" && <p className="hint">{t("loading")}</p>}
      {loaded.state === "error" && (
        <div className="notice" role="alert">
          <p>{t("submissionsFailed")}</p>
          <button type="button" onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      )}
      {loaded.state === "ready" && loaded.items.length === 0 && <p className="hint">{t("noSubmissions")}</p>}
      {loaded.state === "ready" && loaded.items.length > 0 && (
        <table className="submissions">
          <thead>
            <tr>
              <th scope="col">{t("sampleName")}</th>
              <th scope="col">{t("collectionDate")}</th>
              <th scope="col">{t("adminUnit")}</th>
              <th scope="col">{t("serotype")}</th>
              <th scope="col">{t("stageLabel")}</th>
              <th scope="col">{t("submittedAt")}</th>
              {everyone && <th scope="col">{t("submitter")}</th>}
            </tr>
          </thead>
          <tbody>
            {loaded.items.map((item) => (
              <tr key={item.internalId} data-stage={item.stage}>
                <th scope="row">
                  {item.displayName}
                  <small>{item.internalId}</small>
                </th>
                <td>{item.collectionDate}</td>
                <td>{unitName(provinces.units, item.unitCode, lang)}</td>
                <td>{item.lineage?.toUpperCase() ?? ""}</td>
                <td>
                  <span className="stage">{t(`stage_${item.stage}`)}</span>
                  {item.stage === "rejected" && <small>{t(rejectionMessage(item.rejectCode))}</small>}
                  {[...item.placements, ...item.inDatasets].map((where) => (
                    <a key={where.dataset} href={`#/d/${where.dataset}/t/${item.internalId}`}>
                      {t("viewOnTree", { title: where.title })}
                    </a>
                  ))}
                  {/* Chỉ ở danh sách của chính mình: mẫu của người khác thì admin xem được nhưng không sửa hộ. */}
                  {!everyone && canCorrect(item) && <a href={`#/mine/${item.internalId}/edit`}>{t("correctSample")}</a>}
                  {admin && (item.status === "accepted" || item.status === "hidden") && (
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => void setHidden(item, item.status === "accepted")}
                    >
                      {t(item.status === "accepted" ? "hideSample" : "unhideSample")}
                    </button>
                  )}
                </td>
                <td>{when(item.submittedAt, lang)}</td>
                {everyone && <td>{item.submitterName}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
