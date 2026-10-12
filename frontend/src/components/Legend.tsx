import { useMemo } from "react";

import { formatNumber } from "../i18n";
import { useT, useUi } from "../state/store";
import { OTHER_COLOR, type Coloring } from "../tree/colors";
import type { Column } from "../tree/columns";
import { MISSING, visibleCounts } from "../tree/filter";

interface Props {
  column: Column;
  coloring: Coloring;
  /** Mặt nạ tip đang hiện, để chú giải ghi số mẫu còn thấy của từng giá trị. */
  tipVisible: Uint8Array;
}

const MISSING_COLOR = "#b9bfc2";

/**
 * Chú giải của cột đang tô màu, đồng thời là bộ lọc: mỗi dòng là một nút bật, tắt.
 * Thanh mờ phía sau mỗi dòng cho biết giá trị đó chiếm bao nhiêu mẫu so với giá trị đông nhất.
 */
export function Legend({ column, coloring, tipVisible }: Props) {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const selected = useUi((state) => state.filters.values[column.key]);
  const toggleValue = useUi((state) => state.toggleValue);
  const shown = useMemo(() => visibleCounts(column, tipVisible), [column, tipVisible]);

  const largest = Math.max(1, column.missing, ...column.counts);
  const rows = [
    ...coloring.order.map((code) => ({
      code,
      label: column.labels[code],
      color: coloring.slotOfValue[code] < coloring.distinct ? coloring.colors[coloring.slotOfValue[code]] : OTHER_COLOR,
      total: column.counts[code],
      visible: shown.counts[code],
    })),
    ...(column.missing > 0
      ? [
          {
            code: MISSING,
            label: t("missingValue"),
            color: MISSING_COLOR,
            total: column.missing,
            visible: shown.missing,
          },
        ]
      : []),
  ];
  const firstOther = coloring.distinct < column.values.length ? coloring.distinct : -1;

  return (
    <div className="legend">
      <p className="hint">{t("legendHint")}</p>
      <ul className="legend__list">
        {rows.map((row, index) => (
          <li key={row.code}>
            {index === firstOther && <p className="legend__divider">{t("otherValues")}</p>}
            <button
              type="button"
              className="legend__row"
              aria-pressed={selected?.includes(row.code) ?? false}
              onClick={() => toggleValue(column.key, row.code)}
            >
              <i className="legend__bar" style={{ width: `${(row.total / largest) * 100}%` }} />
              <i className="swatch" style={{ background: row.color }} />
              <span className="legend__label">{row.label}</span>
              <span className="legend__count">
                {row.visible === row.total
                  ? formatNumber(lang, row.total)
                  : `${formatNumber(lang, row.visible)} / ${formatNumber(lang, row.total)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
