import { useId, useMemo, useState } from "react";

import type { AdminUnit } from "../api";
import { useProvinces } from "../data/provinces";
import type { MessageKey } from "../i18n";
import { useT, useUi } from "../state/store";
import { provincesOn, readCollectionDate, type CollectionDate, type Precision } from "../submit/form";
import { Choice } from "./Choice";

/** Bốn trường người nộp khai về một mẫu. Form nộp và form sửa dùng chung, nên hai nơi cùng một cách nhập. */
export type MetadataField = "displayName" | "collectionDate" | "unitCode" | "host";
export const METADATA_FIELDS: readonly MetadataField[] = ["displayName", "collectionDate", "unitCode", "host"];

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

export interface SampleFieldValues {
  name: string;
  precision: Precision;
  dateText: string;
  unitCode: string;
  host: string;
}

const EMPTY: SampleFieldValues = { name: "", precision: "day", dateText: "", unitCode: "", host: HOSTS[0][0] };

export interface SampleFieldsState extends SampleFieldValues {
  setName(name: string): void;
  setPrecision(precision: Precision): void;
  setDateText(text: string): void;
  setUnitCode(code: string): void;
  setHost(host: string): void;
  /** Ngày đã nhập, hoặc `null` khi chưa ra một ngày có thật. */
  date: CollectionDate | null;
  /** Các tỉnh hợp lệ vào ngày đó. */
  choices: AdminUnit[];
  /** Tỉnh đang chọn; rỗng khi chưa chọn, hoặc khi tỉnh đã chọn không tồn tại vào ngày vừa đổi. */
  chosenUnit: string;
  provinces: ReturnType<typeof useProvinces>;
}

export function useSampleFields(initial: SampleFieldValues = EMPTY): SampleFieldsState {
  const provinces = useProvinces();
  const [name, setName] = useState(initial.name);
  const [precision, setPrecision] = useState<Precision>(initial.precision);
  const [dateText, setDateText] = useState(initial.dateText);
  const [unitCode, setUnitCode] = useState(initial.unitCode);
  const [host, setHost] = useState(initial.host);

  const date = useMemo(() => readCollectionDate(precision, dateText), [precision, dateText]);
  const choices = useMemo(() => (date ? provincesOn(provinces.units, date) : []), [provinces.units, date]);
  // Đổi ngày làm danh sách tỉnh đổi theo; tỉnh đã chọn mà không còn trong danh sách thì coi như chưa chọn.
  const chosenUnit = choices.some((unit) => unit.code === unitCode) ? unitCode : "";

  return {
    name,
    setName,
    precision,
    setPrecision,
    dateText,
    setDateText,
    unitCode,
    setUnitCode,
    host,
    setHost,
    date,
    choices,
    chosenUnit,
    provinces,
  };
}

/** Lỗi mà form tự thấy trước khi gửi; server vẫn kiểm tra lại mọi thứ. */
export function missingFields(fields: SampleFieldsState): Partial<Record<MetadataField, MessageKey>> {
  const found: Partial<Record<MetadataField, MessageKey>> = {};
  if (fields.name.trim() === "") found.displayName = "problem_INVALID_NAME";
  if (fields.date === null) found.collectionDate = "problem_INVALID_DATE";
  if (fields.chosenUnit === "") found.unitCode = "problem_UNKNOWN_UNIT";
  return found;
}

interface Props {
  fields: SampleFieldsState;
  problems: Partial<Record<MetadataField, MessageKey>>;
}

export function SampleFields({ fields, problems }: Props) {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const ids = { name: useId(), date: useId(), unit: useId(), host: useId() };
  const { date, choices, chosenUnit, provinces, precision, host } = fields;
  const sets = (["vn63", "vn34"] as const).filter((set) => choices.some((unit) => unit.unitSet === set));
  // Vật chủ của mẫu đang sửa mà không nằm trong danh sách thì vẫn phải chọn lại được, để lưu không âm thầm đổi nó.
  const hosts: [string, string][] = HOSTS.map(([value, label]) => [value, t(label)]);
  if (!HOSTS.some(([value]) => value === host)) hosts.push([host, host]);

  /** Thuộc tính chung của một ô nhập: gắn lời báo lỗi của nó, nếu có. */
  const state = (field: MetadataField, id: string) => ({
    id,
    "aria-invalid": problems[field] ? true : undefined,
    "aria-describedby": `${id}-note`,
  });
  const note = (field: MetadataField, id: string, hint?: MessageKey) => (
    <p id={`${id}-note`} className={problems[field] ? "field__problem" : "hint"}>
      {problems[field] ? t(problems[field]) : hint ? t(hint) : ""}
    </p>
  );

  return (
    <>
      <div className="field">
        <label htmlFor={ids.name}>{t("sampleName")}</label>
        <input
          {...state("displayName", ids.name)}
          type="text"
          maxLength={300}
          autoComplete="off"
          value={fields.name}
          onChange={(event) => fields.setName(event.target.value)}
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
          fields.setPrecision(next);
          fields.setDateText("");
        }}
      />
      <div className="field">
        <label htmlFor={ids.date}>{t("collectionDate")}</label>
        <input
          {...state("collectionDate", ids.date)}
          type={DATE_INPUT[precision].type}
          placeholder={DATE_INPUT[precision].placeholder}
          inputMode={precision === "year" ? "numeric" : undefined}
          value={fields.dateText}
          onChange={(event) => fields.setDateText(event.target.value)}
        />
        {note("collectionDate", ids.date)}
      </div>

      <div className="field">
        <label htmlFor={ids.unit}>{t("province")}</label>
        <select
          {...state("unitCode", ids.unit)}
          value={chosenUnit}
          disabled={date === null || provinces.state !== "ready"}
          onChange={(event) => fields.setUnitCode(event.target.value)}
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
        <select {...state("host", ids.host)} value={host} onChange={(event) => fields.setHost(event.target.value)}>
          {hosts.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {note("host", ids.host)}
      </div>
    </>
  );
}
