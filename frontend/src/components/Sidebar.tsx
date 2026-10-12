import { useId, useMemo } from "react";

import type { Manifest, TipInfo } from "../data/load";
import type { MapData } from "../map/types";
import { useT, useUi } from "../state/store";
import type { Coloring } from "../tree/colors";
import type { Column } from "../tree/columns";
import { isoDate } from "../tree/dates";
import { hasFilters, MISSING } from "../tree/filter";
import type { Axis, Layout } from "../tree/layout";
import type { Tree } from "../tree/parse";
import { Choice } from "./Choice";
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
  /** Hình học của bản đồ khi đã tải, để gọi tên các địa bàn đang lọc. */
  map: MapData | null;
  /** Dataset có cột địa bàn, tức là có bản đồ để bật, tắt. */
  mapAvailable: boolean;
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
  map,
  mapAvailable,
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

  const { dateFrom, dateTo } = ui.filters;

  const filtered = Object.entries(ui.filters.values).filter(([, codes]) => codes.length > 0);
  const area = ui.filters.area;
  // Tên các địa bàn đang lọc; hình học chưa tải xong thì tạm hiện mã.
  const areaNames = area?.codes.map(
    (code) => map?.levels[area.level].find((candidate) => candidate.code === code)?.[lang] ?? code,
  );

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
        {(filtered.length > 0 || areaNames) && (
          <ul className="chips">
            {areaNames && (
              <li>
                <span>
                  {t("areaFilter")}: {areaNames.join(", ")}
                </span>
                <button type="button" aria-label={t("removeAreaFilter")} onClick={ui.clearArea}>
                  ×
                </button>
              </li>
            )}
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
              value={dateFrom ?? ""}
              onChange={(event) => ui.setDateRange(event.target.value || null, dateTo)}
            />
          </div>
          <div>
            <label htmlFor={toId}>{t("dateTo")}</label>
            <input
              id={toId}
              type="date"
              min={firstDay}
              max={lastDay}
              value={dateTo ?? ""}
              onChange={(event) => ui.setDateRange(dateFrom, event.target.value || null)}
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
        {mapAvailable && (
          <Choice<"shown" | "hidden">
            legend={t("map")}
            value={ui.mapOpen ? "shown" : "hidden"}
            options={[
              ["shown", t("mapShown")],
              ["hidden", t("mapHidden")],
            ]}
            onChange={(value) => ui.setMapOpen(value === "shown")}
          />
        )}
      </section>
    </aside>
  );
}
