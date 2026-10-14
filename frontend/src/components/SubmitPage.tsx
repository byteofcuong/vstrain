import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ApiError, submitSample } from "../api";
import type { MessageKey } from "../i18n";
import { useAuth } from "../state/auth";
import { useT } from "../state/store";
import { useSubmissions } from "../state/submissions";
import {
  MAX_FASTA_BYTES,
  identicalSampleNote,
  identicalSamples,
  limitMessage,
  problemMessage,
  type IdenticalSamples,
} from "../submit/form";
import { METADATA_FIELDS, SampleFields, missingFields, useSampleFields, type MetadataField } from "./SampleFields";

type Field = MetadataField | "fasta";
type Problems = Partial<Record<Field, MessageKey>>;

const FIELDS: readonly Field[] = [...METADATA_FIELDS, "fasta"];

export function SubmitPage() {
  const t = useT();
  const user = useAuth((state) => state.user);
  const setJustSubmitted = useSubmissions((state) => state.setJustSubmitted);
  const fields = useSampleFields();
  const [file, setFile] = useState<File | null>(null);
  const [problems, setProblems] = useState<Problems>({});
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [sending, setSending] = useState(false);
  // Lời hỏi lại khi chuỗi giống hệt một mẫu đã có, kèm nội dung form lúc được hỏi: sửa bất kỳ trường nào hay chọn
  // file khác thì lời hỏi không còn đúng với thứ sẽ được gửi, nên nó biến mất.
  const [identical, setIdentical] = useState<{ found: IdenticalSamples; content: string } | null>(null);
  const fileId = useId();
  const summary = useRef<HTMLParagraphElement>(null);
  const question = useRef<HTMLElement>(null);
  const content = JSON.stringify([
    fields.name,
    fields.date?.value,
    fields.chosenUnit,
    fields.host,
    file && [file.name, file.size, file.lastModified],
  ]);
  const asked = identical !== null && identical.content === content ? identical.found : null;

  useEffect(() => {
    if (identical) question.current?.focus();
  }, [identical]);

  if (user === undefined) return <main className="page" />;
  if (user === null) {
    return (
      <main className="page">
        <h1>{t("submitSample")}</h1>
        <p>
          {t("submitNeedsLogin")} <a href="#/login">{t("logIn")}</a>
        </p>
      </main>
    );
  }

  const fail = (found: Problems, general: MessageKey) => {
    setProblems(found);
    setFailure(general);
    // Đưa trình đọc màn hình và con trỏ bàn phím tới lời báo, thay vì để người nộp tự tìm chỗ sai.
    summary.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(false);
  };

  const send = async (allowIdentical: boolean) => {
    const found: Problems = missingFields(fields);
    if (file === null) found.fasta = "problem_FILE_REQUIRED";
    else if (file.size > MAX_FASTA_BYTES) found.fasta = "problem_FASTA_TOO_LARGE";
    if (Object.keys(found).length > 0 || fields.date === null || file === null) return fail(found, "fixProblems");

    setSending(true);
    setProblems({});
    setFailure(null);
    setIdentical(null);
    try {
      const created = await submitSample(
        {
          displayName: fields.name,
          collectionDate: fields.date.value,
          unitCode: fields.chosenUnit,
          host: fields.host || null,
          fasta: await file.text(),
        },
        { allowIdentical },
      );
      setJustSubmitted(created.displayName);
      window.location.hash = "#/mine";
    } catch (error) {
      const sameSequence = error instanceof ApiError ? identicalSamples(error) : null;
      if (sameSequence) {
        setIdentical({ found: sameSequence, content });
      } else if (error instanceof ApiError && error.status === 422) {
        const fromServer: Problems = {};
        for (const detail of error.details) {
          const field = FIELDS.find((one) => one === detail.field);
          if (field && !fromServer[field]) fromServer[field] = problemMessage(detail.code);
        }
        fail(fromServer, "fixProblems");
      } else if (error instanceof ApiError && error.status === 429) {
        fail({}, limitMessage(error.code));
      } else if (error instanceof ApiError && error.status === 413) {
        fail({ fasta: "problem_FASTA_TOO_LARGE" }, "fixProblems");
      } else {
        console.error(error);
        fail({}, "submitFailed");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="page">
      <h1>{t("submitSample")}</h1>
      <p>{t("submitIntro")}</p>
      <form className="form" onSubmit={submit} noValidate>
        <p ref={summary} tabIndex={-1} className={failure ? "notice" : "visually-hidden"} role="alert">
          {failure ? t(failure) : ""}
        </p>

        <SampleFields fields={fields} problems={problems} />

        <div className="field">
          <label htmlFor={fileId}>{t("fastaFile")}</label>
          <input
            id={fileId}
            aria-invalid={problems.fasta ? true : undefined}
            aria-describedby={`${fileId}-note`}
            type="file"
            accept=".fasta,.fa,.fas,.fna,.txt,text/plain"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p id={`${fileId}-note`} className={problems.fasta ? "field__problem" : "hint"}>
            {t(problems.fasta ?? "fastaHint")}
          </p>
        </div>

        {asked && (
          <section ref={question} tabIndex={-1} className="identical" role="alert">
            <p className="identical__title">{t("identicalTitle", { count: asked.total })}</p>
            <ul>
              {asked.matches.map((match, index) => {
                const note = identicalSampleNote(match);
                return (
                  <li key={index}>
                    <span className="identical__name">{match.displayName}</span> ({t(note.key, note.values)})
                  </li>
                );
              })}
            </ul>
            {asked.total > asked.matches.length && (
              <p>{t("identicalMore", { count: asked.total - asked.matches.length })}</p>
            )}
            <p>{t("identicalExplain")}</p>
            <button type="button" className="button" disabled={sending} onClick={() => void send(true)}>
              {t("submitAnyway")}
            </button>
          </section>
        )}

        <button type="submit" className="button button--primary" disabled={sending}>
          {t(sending ? "submitting" : "submitSample")}
        </button>
      </form>
    </main>
  );
}
