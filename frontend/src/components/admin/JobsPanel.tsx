import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  getJob,
  listJobs,
  retryJob,
  type Job,
  type JobDetail,
  type JobPage,
  type JobStatus,
} from "../../api";
import { adminErrorMessage, duration, jobKindLabel, jobSubject, queueIsBusy, when } from "../../admin/format";
import type { MessageKey } from "../../i18n";
import { useT, useUi } from "../../state/store";
import { Choice } from "../Choice";

type Filter = "all" | JobStatus;
type Loaded = { state: "loading" } | { state: "ready"; page: JobPage } | { state: "error" };
type Notice = { tone: "good" | "bad"; key: MessageKey; values?: Record<string, string | number> };

/** Trong lúc còn việc chờ hoặc đang chạy, danh sách tự tải lại theo nhịp này, nhiều nhất bấy nhiêu lần (một giờ). */
const REFRESH_MILLISECONDS = 2000;
const REFRESH_LIMIT = 1800;

const FILTERS: [Filter, MessageKey][] = [
  ["all", "jobsAll"],
  ["queued", "jobStatus_queued"],
  ["running", "jobStatus_running"],
  ["failed", "jobStatus_failed"],
  ["succeeded", "jobStatus_succeeded"],
];

export function JobsPanel() {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const [filter, setFilter] = useState<Filter>("all");
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [open, setOpen] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Tăng sau mỗi lần danh sách được tải: phần chi tiết đang mở tải lại theo, để các bước của một việc đang chạy
  // hiện dần ra.
  const [version, setVersion] = useState(0);
  const refreshes = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await listJobs(filter === "all" ? null : filter, signal);
        setLoaded({ state: "ready", page });
        setVersion((count) => count + 1);
      } catch (error) {
        if (signal?.aborted) return;
        console.error(error);
        setLoaded({ state: "error" });
      }
    },
    [filter],
  );

  useEffect(() => {
    const controller = new AbortController();
    refreshes.current = 0;
    setLoaded({ state: "loading" });
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const busy = loaded.state === "ready" && queueIsBusy(loaded.page.counts);
  useEffect(() => {
    if (!busy || refreshes.current >= REFRESH_LIMIT) return;
    const timer = window.setTimeout(() => {
      refreshes.current += 1;
      void load();
    }, REFRESH_MILLISECONDS);
    return () => window.clearTimeout(timer);
  }, [busy, loaded, load]);

  const retry = async (job: Job) => {
    setNotice(null);
    try {
      const id = await retryJob(job.id);
      setNotice({ tone: "good", key: "jobRetried", values: { id: String(id) } });
      refreshes.current = 0;
      await load();
    } catch (error) {
      console.error(error);
      setNotice({ tone: "bad", key: error instanceof ApiError ? adminErrorMessage(error.code) : "actionFailed" });
    }
  };

  return (
    <>
      <h1>{t("adminJobs")}</h1>
      <p>{t("jobsIntro")}</p>
      {loaded.state === "ready" && (
        <p className="queue" data-busy={busy}>
          {t("queueSummary", loaded.page.counts)}{" "}
          {loaded.page.oldestQueuedSeconds !== null &&
            t("queueOldest", { time: duration(loaded.page.oldestQueuedSeconds, lang) })}
        </p>
      )}
      <Choice<Filter>
        legend={t("jobsShown")}
        value={filter}
        options={FILTERS.map(([value, label]) => [value, t(label)])}
        onChange={setFilter}
      />
      {notice && (
        <p className={notice.tone === "good" ? "notice notice--good" : "notice"} role="status">
          {t(notice.key, notice.values)}
        </p>
      )}

      {loaded.state === "loading" && <p className="hint">{t("loading")}</p>}
      {loaded.state === "error" && (
        <div className="notice" role="alert">
          <p>{t("jobsFailedToLoad")}</p>
          <button type="button" onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      )}
      {loaded.state === "ready" && loaded.page.items.length === 0 && <p className="hint">{t("noJobs")}</p>}
      {loaded.state === "ready" && loaded.page.items.length > 0 && (
        <table className="records">
          <thead>
            <tr>
              <th scope="col">{t("jobId")}</th>
              <th scope="col">{t("jobKind")}</th>
              <th scope="col">{t("jobSubject")}</th>
              <th scope="col">{t("jobStatus")}</th>
              <th scope="col">{t("jobCreated")}</th>
              <th scope="col">{t("jobTook")}</th>
              <td />
            </tr>
          </thead>
          <tbody>
            {loaded.page.items.map((job) => (
              <Fragment key={job.id}>
                <tr data-status={job.status} data-job={job.id}>
                  <th scope="row">{job.id}</th>
                  <td>{jobKindLabel(job.kind, lang)}</td>
                  <td>{jobSubject(job.params)}</td>
                  <td>
                    <span className="state" data-status={job.status}>
                      {t(`jobStatus_${job.status}`)}
                    </span>
                    {job.error && <small>{job.error}</small>}
                  </td>
                  <td>{when(job.createdAt, lang)}</td>
                  <td>{job.seconds === null ? "" : duration(job.seconds, lang)}</td>
                  <td className="records__actions">
                    <button
                      type="button"
                      className="quiet"
                      aria-expanded={open === job.id}
                      aria-label={open === job.id ? undefined : t("jobDetailsOf", { id: String(job.id) })}
                      onClick={() => setOpen(open === job.id ? null : job.id)}
                    >
                      {t(open === job.id ? "jobHideDetails" : "jobDetails")}
                    </button>
                  </td>
                </tr>
                {open === job.id && (
                  <tr className="records__detail">
                    <td colSpan={7}>
                      <JobDetails id={job.id} version={version} onRetry={() => void retry(job)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function JobDetails({ id, version, onRetry }: { id: number; version: number; onRetry(): void }) {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getJob(id, controller.signal)
      .then((job) => {
        setDetail(job);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setFailed(true);
      });
    return () => controller.abort();
  }, [id, version]);

  if (failed && detail === null) return <p className="notice">{t("jobDetailsFailed")}</p>;
  if (detail === null) return <p className="hint">{t("loading")}</p>;

  return (
    <div className="job">
      <p className="job__facts">
        {detail.worker && <span>{t("jobWorker", { worker: detail.worker })}</span>}
        {detail.retryOf !== null && <span>{t("jobRetryOf", { id: String(detail.retryOf) })}</span>}
        {detail.retriedBy !== null && <span>{t("jobRetriedBy", { id: String(detail.retriedBy) })}</span>}
        {detail.status === "failed" && detail.retriedBy === null && (
          <button type="button" onClick={onRetry}>
            {t("jobRetry")}
          </button>
        )}
      </p>
      {detail.error && (
        <>
          <h3>{t("jobError")}</h3>
          <pre className="log">{detail.error}</pre>
        </>
      )}
      <h3>{t("jobSteps")}</h3>
      {detail.steps.length === 0 && <p className="hint">{t("jobNoSteps")}</p>}
      {detail.steps.length > 0 && (
        <table className="records records--plain">
          <thead>
            <tr>
              <th scope="col">{t("jobStep")}</th>
              <th scope="col">{t("jobStatus")}</th>
              <th scope="col">{t("jobTook")}</th>
            </tr>
          </thead>
          <tbody>
            {detail.steps.map((step) => (
              <tr key={step.position}>
                <th scope="row">
                  {step.name}
                  {step.logTail && (
                    <details>
                      <summary>{t("jobLog", { name: step.name })}</summary>
                      <pre className="log">{step.logTail}</pre>
                    </details>
                  )}
                </th>
                <td>
                  <span className="state" data-status={step.status}>
                    {t(`jobStatus_${step.status}`)}
                  </span>
                </td>
                <td>{step.seconds === null ? "" : duration(step.seconds, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
