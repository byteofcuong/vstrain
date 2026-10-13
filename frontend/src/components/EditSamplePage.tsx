import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError, correctSubmission, getSubmission, type Submission } from "../api";
import type { MessageKey } from "../i18n";
import { useAuth } from "../state/auth";
import { useT } from "../state/store";
import { useSubmissions } from "../state/submissions";
import { canCorrect, correctionMessage, problemMessage, typedDate } from "../submit/form";
import { METADATA_FIELDS, SampleFields, missingFields, useSampleFields, type MetadataField } from "./SampleFields";

type Problems = Partial<Record<MetadataField, MessageKey>>;
type Loaded =
  | { state: "loading" }
  | { state: "ready"; submission: Submission }
  | { state: "refused"; message: MessageKey }
  | { state: "error" };

/** Form sửa tên, ngày, tỉnh và vật chủ của một mẫu mình đã nộp. Chuỗi không sửa được. */
export function EditSamplePage({ internalId }: { internalId: string }) {
  const t = useT();
  const user = useAuth((state) => state.user);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const loggedIn = Boolean(user);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoaded({ state: "loading" });
      try {
        const submission = await getSubmission(internalId, signal);
        if (canCorrect(submission)) setLoaded({ state: "ready", submission });
        else {
          const message = submission.stage === "processing" ? "editBeingChecked" : "editNotEditable";
          setLoaded({ state: "refused", message });
        }
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof ApiError && error.status === 404) setLoaded({ state: "refused", message: "editNotFound" });
        else {
          console.error(error);
          setLoaded({ state: "error" });
        }
      }
    },
    [internalId],
  );

  useEffect(() => {
    if (!loggedIn) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [loggedIn, load]);

  if (user === undefined) return <main className="page" />;

  const back = (
    <p>
      <a href="#/mine">{t("backToMySamples")}</a>
    </p>
  );
  return (
    <main className="page">
      <h1>{t("editSample")}</h1>
      {user === null && (
        <p>
          {t("submitNeedsLogin")} <a href="#/login">{t("logIn")}</a>
        </p>
      )}
      {user !== null && loaded.state === "loading" && <p className="hint">{t("loading")}</p>}
      {user !== null && loaded.state === "error" && (
        <div className="notice" role="alert">
          <p>{t("editLoadFailed")}</p>
          <button type="button" onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      )}
      {user !== null && loaded.state === "refused" && (
        <>
          <p className="notice" role="alert">
            {t(loaded.message)}
          </p>
          {back}
        </>
      )}
      {user !== null && loaded.state === "ready" && (
        // Mẫu khác thì form khác: các ô lấy giá trị đầu từ mẫu, một lần lúc dựng.
        <EditForm key={loaded.submission.internalId} submission={loaded.submission} />
      )}
    </main>
  );
}

function EditForm({ submission }: { submission: Submission }) {
  const t = useT();
  const setJustCorrected = useSubmissions((state) => state.setJustCorrected);
  const typed = typedDate(submission.collectionDate);
  const fields = useSampleFields({
    name: submission.displayName,
    precision: typed?.precision ?? "day",
    dateText: typed?.text ?? "",
    unitCode: submission.unitCode ?? "",
    host: submission.host ?? "",
  });
  const [problems, setProblems] = useState<Problems>({});
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const summary = useRef<HTMLParagraphElement>(null);

  const fail = (found: Problems, general: MessageKey) => {
    setProblems(found);
    setFailure(general);
    summary.current?.focus();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const found = missingFields(fields);
    if (Object.keys(found).length > 0 || fields.date === null) return fail(found, "fixProblemsToSave");

    setSaving(true);
    setProblems({});
    setFailure(null);
    try {
      const saved = await correctSubmission(submission.internalId, {
        displayName: fields.name,
        collectionDate: fields.date.value,
        unitCode: fields.chosenUnit,
        host: fields.host || null,
      });
      setJustCorrected(saved.displayName);
      window.location.hash = "#/mine";
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const fromServer: Problems = {};
        for (const detail of error.details) {
          const field = METADATA_FIELDS.find((one) => one === detail.field);
          if (field && !fromServer[field]) fromServer[field] = problemMessage(detail.code);
        }
        fail(fromServer, "fixProblemsToSave");
      } else if (error instanceof ApiError) {
        fail({}, correctionMessage(error.code));
      } else {
        console.error(error);
        fail({}, "editFailed");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p>{t("editSampleIntro", { id: submission.internalId })}</p>
      <form className="form" onSubmit={save} noValidate>
        <p ref={summary} tabIndex={-1} className={failure ? "notice" : "visually-hidden"} role="alert">
          {failure ? t(failure) : ""}
        </p>
        <SampleFields fields={fields} problems={problems} />
        <button type="submit" className="button button--primary" disabled={saving}>
          {t(saving ? "savingChanges" : "saveChanges")}
        </button>{" "}
        <a href="#/mine">{t("backToMySamples")}</a>
      </form>
    </>
  );
}
