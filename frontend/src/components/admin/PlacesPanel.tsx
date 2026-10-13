import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  addAlias,
  listAliases,
  listUnits,
  listUnresolvedPlaces,
  removeAlias,
  type AdminUnit,
  type AliasChange,
  type PlaceAlias,
  type UnresolvedPlace,
  type UnresolvedPlaces,
} from "../../api";
import { adminErrorMessage, unitGroups } from "../../admin/format";
import { unitName } from "../../data/provinces";
import { formatNumber, type MessageKey } from "../../i18n";
import { useT, useUi } from "../../state/store";

type Loaded =
  | { state: "loading" }
  | { state: "ready"; unresolved: UnresolvedPlaces; aliases: PlaceAlias[]; units: AdminUnit[] }
  | { state: "error" };
type Notice =
  | { tone: "bad"; key: MessageKey }
  | { tone: "good"; key: "placeAssigned" | "placeRemoved"; text: string; change: AliasChange };

export function PlacesPanel() {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [unresolved, aliases, units] = await Promise.all([
        listUnresolvedPlaces(signal),
        listAliases(signal),
        listUnits(signal),
      ]);
      setLoaded({ state: "ready", unresolved, aliases, units });
    } catch (error) {
      if (signal?.aborted) return;
      console.error(error);
      setLoaded({ state: "error" });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const units = loaded.state === "ready" ? loaded.units : null;
  const groups = useMemo(() => (units ? unitGroups(units, lang) : []), [units, lang]);

  const change = async (key: "placeAssigned" | "placeRemoved", text: string, action: () => Promise<AliasChange>) => {
    setNotice(null);
    setWorking(true);
    try {
      setNotice({ tone: "good", key, text, change: await action() });
      await load();
    } catch (error) {
      console.error(error);
      setNotice({ tone: "bad", key: error instanceof ApiError ? adminErrorMessage(error.code) : "actionFailed" });
    } finally {
      setWorking(false);
    }
  };

  const assign = (place: UnresolvedPlace) =>
    change("placeAssigned", place.text, () => addAlias(place.text, chosen[place.key]));
  const remove = (alias: PlaceAlias) => change("placeRemoved", alias.text, () => removeAlias(alias.key));

  return (
    <>
      <h1>{t("adminPlaces")}</h1>
      <p>{t("placesIntro")}</p>
      {notice?.tone === "bad" && (
        <p className="notice" role="status">
          {t(notice.key)}
        </p>
      )}
      {notice?.tone === "good" && (
        <p className="notice notice--good" role="status">
          {t(notice.key, { text: notice.text, count: notice.change.changedSamples })}{" "}
          {notice.change.republished.length > 0 &&
            t("placeRepublished", { list: notice.change.republished.join(", ") })}
        </p>
      )}

      {loaded.state === "loading" && <p className="hint">{t("loading")}</p>}
      {loaded.state === "error" && (
        <div className="notice" role="alert">
          <p>{t("placesFailedToLoad")}</p>
          <button type="button" onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      )}
      {loaded.state === "ready" && loaded.unresolved.items.length === 0 && (
        <p className="hint">{t("placesAllResolved")}</p>
      )}
      {loaded.state === "ready" && loaded.unresolved.items.length > 0 && (
        <>
          <p className="queue">
            {t("placesSummary", { samples: loaded.unresolved.samples, count: loaded.unresolved.items.length })}
          </p>
          <table className="records">
            <thead>
              <tr>
                <th scope="col">{t("placeSpelling")}</th>
                <th scope="col">{t("placeSamples")}</th>
                <th scope="col">{t("placeUnit")}</th>
                <td />
              </tr>
            </thead>
            <tbody>
              {loaded.unresolved.items.map((place) => (
                <tr key={place.key} data-place={place.key}>
                  <th scope="row">
                    {place.text}
                    {place.spellings.length > 1 && (
                      <small>{t("placeAlso", { list: place.spellings.slice(1).join(", ") })}</small>
                    )}
                  </th>
                  <td>{formatNumber(lang, place.samples)}</td>
                  <td>
                    <select
                      aria-label={t("placeUnitFor", { text: place.text })}
                      value={chosen[place.key] ?? ""}
                      onChange={(event) => setChosen({ ...chosen, [place.key]: event.target.value })}
                    >
                      <option value="">{t("placeChoose")}</option>
                      {groups.map((group) => (
                        <optgroup key={group.label} label={t(group.label)}>
                          {group.units.map((unit) => (
                            <option key={unit.code} value={unit.code}>
                              {unit.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="records__actions">
                    <button
                      type="button"
                      aria-label={`${t("placeAssign")}: ${place.text}`}
                      disabled={working || !chosen[place.key]}
                      onClick={() => void assign(place)}
                    >
                      {t("placeAssign")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {loaded.state === "ready" && (
        <section className="page__section">
          <h2>{t("placeAliases")}</h2>
          {loaded.aliases.length === 0 && <p className="hint">{t("placeNoAliases")}</p>}
          {loaded.aliases.length > 0 && (
            <table className="records">
              <thead>
                <tr>
                  <th scope="col">{t("placeSpelling")}</th>
                  <th scope="col">{t("placeUnit")}</th>
                  <td />
                </tr>
              </thead>
              <tbody>
                {loaded.aliases.map((alias) => (
                  <tr key={alias.key} data-alias={alias.key}>
                    <th scope="row">{alias.text}</th>
                    <td>{unitName(loaded.units, alias.unitCode, lang)}</td>
                    <td className="records__actions">
                      <button
                        type="button"
                        className="quiet"
                        aria-label={`${t("placeRemove")}: ${alias.text}`}
                        disabled={working}
                        onClick={() => void remove(alias)}
                      >
                        {t("placeRemove")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
