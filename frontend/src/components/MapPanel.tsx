import { useMemo, useState, type KeyboardEvent } from "react";

import { formatNumber } from "../i18n";
import type { MapState } from "../map/load";
import {
  countAreas,
  coverage,
  defaultLevel,
  HOME_COUNTRY,
  homeMask,
  placeTips,
  type OpeningLevel,
} from "../map/placement";
import { colorOf, EMPTY_COLOR, SCALE, scaleLabels } from "../map/scale";
import type { MapData, MapLevel } from "../map/types";
import { useT, useUi, type MapGrain, type ProvinceSet } from "../state/store";
import type { Column } from "../tree/columns";
import { Choice } from "./Choice";

interface Props {
  state: MapState;
  onRetry(): void;
  /** Các cột địa bàn mà dataset có đã tải xong chưa; bản đồ chỉ vẽ khi đủ cả hình học lẫn các cột này. */
  places: "loading" | "ready" | "error";
  onRetryPlaces(): void;
  /** Cột mã tỉnh, cột mã vùng hoặc miền, và cột quốc gia của bản publish; `null` khi chưa tải hoặc không có. */
  unit: Column | null;
  region: Column | null;
  country: Column | null;
  tipVisible: Uint8Array;
}

const GRAIN_OF: Record<OpeningLevel, MapGrain> = { vn34: "province", region: "region", macro: "macro" };
const GRAIN_WORD = { macro: "byMacro", region: "byRegion", province: "byProvince" } as const;

/** Bảng bản đồ: mẫu của Việt Nam theo miền, vùng hoặc tỉnh; bấm vào một địa bàn để lọc cây theo nó. */
export function MapPanel({ state, onRetry, places, onRetryPlaces, unit, region, country, tipVisible }: Props) {
  const t = useT();
  const failed = state.status === "error" || places === "error";

  return (
    <section className="map" aria-label={t("mapTitle")}>
      <h2>{t("mapTitle")}</h2>
      {state.status === "error" && (
        <div className="notice" role="alert">
          <p>{t("mapLoadFailed")}</p>
          <button type="button" onClick={onRetry}>
            {t("retry")}
          </button>
        </div>
      )}
      {places === "error" && (
        <div className="notice" role="alert">
          <p>{t("mapDataFailed")}</p>
          <button type="button" onClick={onRetryPlaces}>
            {t("retry")}
          </button>
        </div>
      )}
      {!failed && (state.status !== "ready" || places !== "ready") && <p className="hint">{t("mapLoading")}</p>}
      {state.status === "ready" && places === "ready" && (
        <Figure map={state.data} unit={unit} region={region} country={country} tipVisible={tipVisible} />
      )}
    </section>
  );
}

interface FigureProps extends Pick<Props, "unit" | "region" | "country" | "tipVisible"> {
  map: MapData;
}

function Figure({ map, unit, region, country, tipVisible }: FigureProps) {
  const t = useT();
  const lang = useUi((ui) => ui.lang);
  const chosenGrain = useUi((ui) => ui.mapGrain);
  const provinceSet = useUi((ui) => ui.provinceSet);
  const areaFilter = useUi((ui) => ui.filters.area);
  const setMapGrain = useUi((ui) => ui.setMapGrain);
  const setProvinceSet = useUi((ui) => ui.setProvinceSet);
  const toggleArea = useUi((ui) => ui.toggleArea);
  /** Địa bàn đang được rê chuột hoặc focus (chỉ số), -1 là không có. */
  const [active, setActive] = useState(-1);

  const home = useMemo(() => homeMask(country, HOME_COUNTRY), [country]);

  // Cấp mở đầu: tính trên mọi tip, không theo bộ lọc, để bản đồ không tự đổi cấp khi người xem lọc.
  const openingGrain = useMemo(() => {
    const everyTip = new Uint8Array(tipVisible.length).fill(1);
    const placedAt = (level: MapLevel) => coverage(placeTips(map, level, unit, region), home, everyTip);
    const placed = {
      vn34: placedAt("vn34").placed,
      region: placedAt("region").placed,
      macro: placedAt("macro").placed,
    };
    return GRAIN_OF[defaultLevel(placed, placedAt("macro").home)];
  }, [map, unit, region, home, tipVisible.length]);

  const grain = chosenGrain ?? openingGrain;
  const level: MapLevel = grain === "province" ? provinceSet : grain;
  const areas = map.levels[level];

  const areaOfTip = useMemo(() => placeTips(map, level, unit, region), [map, level, unit, region]);
  const counts = useMemo(() => countAreas(areaOfTip, areas.length, tipVisible), [areaOfTip, areas.length, tipVisible]);
  const placed = useMemo(() => coverage(areaOfTip, home, tipVisible), [areaOfTip, home, tipVisible]);
  const selected = areaFilter?.level === level ? areaFilter.codes : [];
  // Bộ lọc đặt ở một cấp khác (chọn một miền rồi xem theo tỉnh): các địa bàn của nó không có hình ở cấp này.
  const context =
    areaFilter && areaFilter.level !== level
      ? map.levels[areaFilter.level].filter((area) => areaFilter.codes.includes(area.code))
      : [];

  const words = { level: t(GRAIN_WORD[grain]) };
  const name = (index: number) => areas[index][lang];
  /** "12 mẫu", hoặc "3 trong 12 mẫu" khi bộ lọc đang giấu bớt. */
  const amount = (index: number) =>
    counts.visible[index] === counts.total[index]
      ? t("samplesCount", { count: counts.total[index] })
      : t("samplesCountOf", { shown: counts.visible[index], count: counts.total[index] });
  const describe = (index: number) =>
    counts.visible[index] === counts.total[index]
      ? t("areaSamples", { name: name(index), count: counts.total[index] })
      : t("areaSamplesOf", { name: name(index), shown: counts.visible[index], count: counts.total[index] });
  const onKey = (event: KeyboardEvent, code: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleArea(level, code);
  };

  // Danh sách địa bàn có mẫu, nhiều mẫu đang hiện nhất đứng trước.
  const listed = areas
    .map((_, index) => index)
    .filter((index) => counts.total[index] > 0)
    .sort(
      (a, b) =>
        counts.visible[b] - counts.visible[a] ||
        counts.total[b] - counts.total[a] ||
        name(a).localeCompare(name(b), lang),
    );
  const labels = scaleLabels(lang);

  return (
    <>
      <Choice<MapGrain>
        legend={t("mapGrain")}
        value={grain}
        options={[
          ["macro", t("grainMacro")],
          ["region", t("grainRegion")],
          ["province", t("grainProvince")],
        ]}
        onChange={setMapGrain}
      />
      {grain === "province" && (
        <>
          <Choice<ProvinceSet>
            legend={t("provinceSet")}
            value={provinceSet}
            options={[
              ["vn34", t("setCurrent")],
              ["vn63", t("setOld")],
            ]}
            onChange={setProvinceSet}
          />
          <p className="hint">{t(provinceSet === "vn34" ? "setCurrentHint" : "setOldHint")}</p>
        </>
      )}

      <p className="map__summary" aria-live="polite">
        {placed.home === null
          ? t("mapPlacedOnly", { placed: placed.placed, ...words })
          : t("mapPlaced", { placed: placed.placed, home: placed.home, ...words })}{" "}
        {placed.home !== null &&
          placed.home > placed.placed &&
          t("mapUnplaced", { count: placed.home - placed.placed })}
      </p>

      <div className="map__figure">
        <svg
          className="map__svg"
          viewBox={`0 0 ${map.width} ${map.height}`}
          role="group"
          aria-label={t("mapOf", words)}
          data-level={level}
        >
          {areas.map((area, index) => {
            const has = counts.total[index] > 0;
            const color = colorOf(counts.visible[index]);
            const interactive = has
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-pressed": selected.includes(area.code),
                  "aria-label": describe(index),
                  onClick: () => toggleArea(level, area.code),
                  onKeyDown: (event: KeyboardEvent) => onKey(event, area.code),
                  onFocus: () => setActive(index),
                  onBlur: () => setActive(-1),
                }
              : { "aria-hidden": true };
            return (
              <g
                key={area.code}
                className={has ? "map__area map__area--has" : "map__area"}
                data-code={area.code}
                data-shown={counts.visible[index]}
                data-total={counts.total[index]}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive((current) => (current === index ? -1 : current))}
                {...interactive}
              >
                <path className="map__shape" d={area.d} fill={color} />
                {area.dots && (
                  // Chấm của địa bàn không có mẫu dùng màu xám của CSS: màu đất trống quá nhạt để thấy trên biển.
                  <path
                    className="map__dots"
                    d={area.dots}
                    style={color === EMPTY_COLOR ? undefined : { stroke: color }}
                  />
                )}
              </g>
            );
          })}
          {/* Đường viền của địa bàn đang chọn và đang trỏ tới vẽ đè lên trên, để không bị địa bàn bên cạnh che. */}
          {areas.map(
            (area, index) =>
              (selected.includes(area.code) || index === active) && (
                <path
                  key={area.code}
                  className={index === active ? "map__outline map__outline--active" : "map__outline"}
                  d={area.d + (area.dots ?? "")}
                />
              ),
          )}
          {/* Đường bao nét đứt của địa bàn đang lọc ở cấp khác, để thấy các số trên bản đồ đang bị giới hạn ở đâu. */}
          {context.map((area) => (
            <path key={area.code} className="map__outline map__outline--context" d={area.d} />
          ))}
          {map.labels.map((label) => (
            <text key={label.vi} className="map__label" x={label.at[0]} y={label.at[1] - 14} aria-hidden="true">
              {label[lang]}
            </text>
          ))}
        </svg>
        {active >= 0 && (
          <div
            className={areas[active].at[0] > map.width * 0.55 ? "tooltip tooltip--left" : "tooltip"}
            style={{
              left: `${(areas[active].at[0] / map.width) * 100}%`,
              top: `${(areas[active].at[1] / map.height) * 100}%`,
            }}
          >
            <strong className="tooltip__name">{name(active)}</strong>
            <span>{counts.total[active] > 0 ? amount(active) : t("areaEmpty")}</span>
          </div>
        )}
      </div>

      <div className="map__scale">
        <span>{t("mapScale")}</span>
        <ol>
          {SCALE.map((step, index) => (
            <li key={step.from}>
              <i className="swatch" style={{ background: step.color }} />
              {labels[index]}
            </li>
          ))}
        </ol>
      </div>

      {listed.length > 0 && (
        <>
          <table className="map__list">
            <caption>{t("mapList")}</caption>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">{t("mapArea")}</th>
                <th scope="col">{t("mapCount")}</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((index) => (
                <tr key={areas[index].code}>
                  <th scope="row">
                    <button
                      type="button"
                      className="map__row"
                      aria-pressed={selected.includes(areas[index].code)}
                      onClick={() => toggleArea(level, areas[index].code)}
                      onPointerEnter={() => setActive(index)}
                      onPointerLeave={() => setActive((current) => (current === index ? -1 : current))}
                    >
                      <i className="swatch" style={{ background: colorOf(counts.visible[index]) }} />
                      {name(index)}
                    </button>
                  </th>
                  <td>
                    {counts.visible[index] === counts.total[index]
                      ? formatNumber(lang, counts.total[index])
                      : `${formatNumber(lang, counts.visible[index])} / ${formatNumber(lang, counts.total[index])}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">{t("mapListHint")}</p>
        </>
      )}

      <p className="map__note">{t("mapNote")}</p>
      <p className="map__note">{t("mapCredit")}</p>
    </>
  );
}
