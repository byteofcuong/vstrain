import { useId, useMemo, useRef, useState, type FormEvent } from "react";

import { ApiError, submitSample } from "../api";
import { useProvinces } from "../data/provinces";
import type { MessageKey } from "../i18n";
import { useAuth } from "../state/auth";
import { useT, useUi } from "../state/store";
import { useSubmissions } from "../state/submissions";
import { MAX_FASTA_BYTES, problemMessage, provincesOn, readCollectionDate, type Precision } from "../submit/form";
import { Choice } from "./Choice";

type Field = "displayName" | "collectionDate" | "unitCode" | "host" | "fasta";
type Problems = Partial<Record<Field, MessageKey>>;

const FIELDS: readonly Field[] = ["displayName", "collectionDate", "unitCode", "host", "fasta"];
/** Loại ô nhập của trình duyệt cho từng mức biết ngày. */
const DATE_INPUT: Record<Precision, { type: string; placeholder: string }> = {
  day: { type: "date", placeholder: "2024-01-15" },
  month: { type: "month", placeholder: "2024-01" },
  year: { type: "text", placeholder: "2024" },
};
/** Giá trị gửi đi là tên khoa học, cùng cách viết với các bản ghi GenBank đã nhập. */
const HOSTS: [string, MessageKey][] = [
  ["Homo sapiens", "hostHuman"],
  ["Aedes aegypti", "hostAegypti"],
  ["Aedes albopictus", "hostAlbopictus"],
  ["", "hostUnknown"],
];

export function SubmitPage() {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const user = useAuth((state) => state.user);
  const setJustSubmitted = useSubmissions((state) => state.setJustSubmitted);
  const provinces = useProvinces();
  const [name, setName] = useState("");
  const [precision, setPrecision] = useState<Precision>("day");
  const [dateText, setDateText] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [host, setHost] = useState(HOSTS[0][0]);
  const [file, setFile] = useState<File | null>(null);
  const [problems, setProblems] = useState<Problems>({});
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [sending, setSending] = useState(false);
  const ids = { name: useId(), date: useId(), unit: useId(), host: useId(), file: useId() };
  const summary = useRef<HTMLParagraphElement>(null);

  const date = useMemo(() => readCollectionDate(precision, dateText), [precision, dateText]);
  const choices = useMemo(() => (date ? provincesOn(provinces.units, date) : []), [provinces.units, date]);
  // Đổi ngày làm danh sách tỉnh đổi theo; tỉnh đã chọn mà không còn trong danh sách thì coi như chưa chọn.
  const chosenUnit = choices.some((unit) => unit.code === unitCode) ? unitCode : "";
  const sets = (["vn63", "vn34"] as const).filter((set) => choices.some((unit) => unit.unitSet === set));

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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Problems = {};
    if (name.trim() === "") found.displayName = "problem_INVALID_NAME";
    if (date === null) found.collectionDate = "problem_INVALID_DATE";
    if (chosenUnit === "") found.unitCode = "problem_UNKNOWN_UNIT";
    if (file === null) found.fasta = "problem_FILE_REQUIRED";
    else if (file.size > MAX_FASTA_BYTES) found.fasta = "problem_FASTA_TOO_LARGE";
    if (Object.keys(found).length > 0 || date === null || file === null) return fail(found, "fixProblems");

    setSending(true);
    setProblems({});
    setFailure(null);
    try {
      const created = await submitSample({
        displayName: name,
        collectionDate: date.value,
        unitCode: chosenUnit,
        host: host || null,
        fasta: await file.text(),
      });
      setJustSubmitted(created.displayName);
      window.location.hash = "#/mine";
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const fromServer: Problems = {};
        for (const detail of error.details) {
          const field = FIELDS.find((one) => one === detail.field);
          if (field && !fromServer[field]) fromServer[field] = problemMessage(detail.code);
        }
        fail(fromServer, "fixProblems");
      } else if (error instanceof ApiError && error.status === 429) {
        fail({}, "submitTooMany");
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

  /** Thuộc tính chung của một ô nhập: gắn lời báo lỗi của nó, nếu có. */
  const state = (field: Field, id: string) => ({
    id,
    "aria-invalid": problems[field] ? true : undefined,
    "aria-describedby": `${id}-note`,
  });
  const note = (field: Field, id: string, hint?: MessageKey) => (
    <p id={`${id}-note`} className={problems[field] ? "field__problem" : "hint"}>
      {problems[field] ? t(problems[field]) : hint ? t(hint) : ""}
    </p>
  );

  return (
    <main className="page">
      <h1>{t("submitSample")}</h1>
      <p>{t("submitIntro")}</p>
      <form className="form" onSubmit={submit} noValidate>
        <p ref={summary} tabIndex={-1} className={failure ? "notice" : "visually-hidden"} role="alert">
          {failure ? t(failure) : ""}
        </p>

        <div className="field">
          <label htmlFor={ids.name}>{t("sampleName")}</label>
          <input
            {...state("displayName", ids.name)}
            type="text"
            maxLength={300}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {note("displayName", ids.name, "sampleNameHint")}
        </div>

        <Choice<Precision>
          legend={t("datePrecision")}
          value={precision}
          options={[
            ["day", t("precisionDay")],
            ["month", t("precisionMonth")],
            ["year", t("precisionYear")],
          ]}
          onChange={(next) => {
            setPrecision(next);
            setDateText("");
          }}
        />
        <div className="field">
          <label htmlFor={ids.date}>{t("collectionDate")}</label>
          <input
            {...state("collectionDate", ids.date)}
            type={DATE_INPUT[precision].type}
            placeholder={DATE_INPUT[precision].placeholder}
            inputMode={precision === "year" ? "numeric" : undefined}
            value={dateText}
            onChange={(event) => setDateText(event.target.value)}
          />
          {note("collectionDate", ids.date)}
        </div>

        <div className="field">
          <label htmlFor={ids.unit}>{t("province")}</label>
          <select
            {...state("unitCode", ids.unit)}
            value={chosenUnit}
            disabled={date === null || provinces.state !== "ready"}
            onChange={(event) => setUnitCode(event.target.value)}
          >
            <option value="">{t(date === null ? "provinceNeedsDate" : "chooseProvince")}</option>
            {sets.map((set) => {
              const options = choices
                .filter((unit) => unit.unitSet === set)
                .map((unit) => (
                  <option key={unit.code} value={unit.code}>
                    {lang === "vi" ? unit.nameVi : unit.nameEn}
                  </option>
                ));
              // Chỉ khi cả hai bộ cùng hợp lệ (mẫu của năm 2025) mới cần ghi rõ tỉnh thuộc bộ nào.
              return sets.length === 1 ? (
                options
              ) : (
                <optgroup key={set} label={t(set === "vn63" ? "provinceSet63" : "provinceSet34")}>
                  {options}
                </optgroup>
              );
            })}
          </select>
          {provinces.state === "error" ? (
            <p id={`${ids.unit}-note`} className="field__problem">
              {t("provincesFailed")}{" "}
              <button type="button" className="quiet" onClick={provinces.retry}>
                {t("retry")}
              </button>
            </p>
          ) : (
            note("unitCode", ids.unit, "provinceHint")
          )}
        </div>

        <div className="field">
          <label htmlFor={ids.host}>{t("host")}</label>
          <select {...state("host", ids.host)} value={host} onChange={(event) => setHost(event.target.value)}>
            {HOSTS.map(([value, label]) => (
              <option key={label} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
          {note("host", ids.host)}
        </div>

        <div className="field">
          <label htmlFor={ids.file}>{t("fastaFile")}</label>
          <input
            {...state("fasta", ids.file)}
            type="file"
            accept=".fasta,.fa,.fas,.fna,.txt,text/plain"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {note("fasta", ids.file, "fastaHint")}
        </div>

        <button type="submit" className="button button--primary" disabled={sending}>
          {t(sending ? "submitting" : "submitSample")}
        </button>
      </form>
    </main>
  );
}
