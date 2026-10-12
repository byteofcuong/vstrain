import { useId, useMemo } from "react";

import type { Manifest, TipInfo } from "../data/load";
import { useT, useUi } from "../state/store";
import type { Coloring } from "../tree/colors";
import type { Column } from "../tree/columns";
import { decimalYear, isoDate } from "../tree/dates";
import { hasFilters, MISSING } from "../tree/filter";
import type { Axis, Layout } from "../tree/layout";
import type { Tree } from "../tree/parse";
import { Legend } from "./Legend";
import { Search } from "./Search";

interface Props {
  manifest: Manifest;
  tree: Tree;
  tips: TipInfo | null;
  columns: ReadonlyMap<string, Column>;
  colorColumn: Column | null;
  coloring: Coloring | null;
  /** Cột đang chọn để tô màu tải không được. */
  colorError: boolean;
  onRetryColor(): void;
  tipVisible: Uint8Array;
  visibleCount: number;
}

/** Một ngày gần trọn: bộ lọc "đến ngày" tính cả ngày được chọn. */
const ALMOST_A_DAY = 0.99 / 366;

function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: [T, string][];
  onChange(value: T): void;
}) {
  const name = useId();
  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      <div className="choice__options">
        {options.map(([option, label]) => (
          <label key={option}>
            <input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Sidebar({
  manifest,
  tree,
  tips,
  columns,
  colorColumn,
  coloring,
  colorError,
  onRetryColor,
  tipVisible,
  visibleCount,
}: Props) {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const ui = useUi();
  const colorId = useId();
  const fromId = useId();
  const toId = useId();

  // Khoảng ngày của các tip, làm giới hạn cho hai ô chọn ngày.
  const [firstDay, lastDay] = useMemo(() => {
    let low = Infinity;
    let high = -Infinity;
    for (let k = 0; k < tree.tipCount; k++) {
      const date = tree.numDate[tree.tipNode[k]];
      if (date < low) low = date;
      if (date > high) high = date;
    }
    return low <= high ? [isoDate(low), isoDate(high)] : ["", ""];
  }, [tree]);

  const { dateMin, dateMax } = ui.filters;
  const setFrom = (text: string) => ui.setDateRange(text === "" ? null : decimalYear(text), dateMax);
  const setTo = (text: string) => {
    const value = text === "" ? null : decimalYear(text);
    ui.setDateRange(dateMin, value === null ? null : value + ALMOST_A_DAY);
  };

  const filtered = Object.entries(ui.filters.values).filter(([, codes]) => codes.length > 0);

  return (
    <aside className="sidebar">
      <div className="sidebar__summary">
        <h1>{manifest.dataset.title}</h1>
        <p aria-live="polite">{t("showing", { shown: visibleCount, total: tree.tipCount })}</p>
        {hasFilters(ui.filters) && (
          <button type="button" className="quiet" onClick={ui.clearFilters}>
            {t("clearFilters")}
          </button>
        )}
        {filtered.length > 0 && (
          <ul className="chips">
            {filtered.map(([key, codes]) => {
              const info = manifest.columns.find((column) => column.key === key);
              const column = columns.get(key);
              const title = info?.title[lang] ?? key;
              const names = codes.map((code) =>
                code === MISSING ? t("missingValue") : (column?.labels[code] ?? String(code)),
              );
              return (
                <li key={key}>
                  <span>
                    {title}: {names.join(", ")}
                  </span>
                  <button
                    type="button"
                    aria-label={t("removeFilter", { column: title })}
                    onClick={() => ui.clearColumnFilter(key)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <section>
        <Search tips={tips} />
      </section>

      <section>
        <label htmlFor={colorId}>{t("colorBy")}</label>
        <select id={colorId} value={ui.colorKey ?? ""} onChange={(event) => ui.setColorKey(event.target.value || null)}>
          <option value="">{t("noColor")}</option>
          {manifest.columns.map((column) => (
            <option key={column.key} value={column.key}>
              {column.title[lang]}
            </option>
          ))}
        </select>
        {colorError && (
          <div className="notice" role="alert">
            <p>{t("columnLoadFailed")}</p>
            <button type="button" onClick={onRetryColor}>
              {t("retry")}
            </button>
          </div>
        )}
        {ui.colorKey !== null && !colorError && (!colorColumn || !coloring) && <p className="hint">{t("loading")}</p>}
        {colorColumn && coloring && <Legend column={colorColumn} coloring={coloring} tipVisible={tipVisible} />}
      </section>

      <section>
        <fieldset className="dates">
          <legend>{t("dateRange")}</legend>
          <div>
            <label htmlFor={fromId}>{t("dateFrom")}</label>
            <input
              id={fromId}
              type="date"
              min={firstDay}
              max={lastDay}
              value={dateMin === null ? "" : isoDate(dateMin)}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={toId}>{t("dateTo")}</label>
            <input
              id={toId}
              type="date"
              min={firstDay}
              max={lastDay}
              value={dateMax === null ? "" : isoDate(dateMax - ALMOST_A_DAY)}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </fieldset>
      </section>

      <section className="sidebar__view">
        <Choice<Layout>
          legend={t("layout")}
          value={ui.layout}
          options={[
            ["rect", t("layoutRect")],
            ["radial", t("layoutRadial")],
          ]}
          onChange={ui.setLayout}
        />
        <Choice<Axis>
          legend={t("axis")}
          value={ui.axis}
          options={[
            ["time", t("axisTime")],
            ["div", t("axisDiv")],
          ]}
          onChange={ui.setAxis}
        />
      </section>
    </aside>
  );
}
