import { useId, useMemo, useState } from "react";

import type { TipInfo } from "../data/load";
import { MIN_QUERY_LENGTH, searchTips } from "../data/search";
import { useT, useUi } from "../state/store";

const MAX_RESULTS = 12;

export function Search({ tips }: { tips: TipInfo | null }) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState("");
  const selectTip = useUi((state) => state.selectTip);
  const result = useMemo(
    () => (tips ? searchTips(tips, query, MAX_RESULTS) : { matches: [], total: 0 }),
    [tips, query],
  );
  const searching = query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="search">
      <label htmlFor={id}>{t("search")}</label>
      <input
        id={id}
        type="search"
        value={query}
        placeholder={t("searchPlaceholder")}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
      />
      {searching && !tips && <p className="hint">{t("searchLoading")}</p>}
      {searching && tips && result.total === 0 && <p className="hint">{t("searchNone")}</p>}
      {tips && result.matches.length > 0 && (
        <ul className="search__results">
          {result.matches.map((tip) => (
            <li key={tip}>
              <button type="button" onClick={() => selectTip(tip)}>
                <span className="search__name">{tips.displayName[tip]}</span>
                {tips.accession[tip] && <span className="search__accession">{tips.accession[tip]}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {result.total > result.matches.length && (
        <p className="hint">{t("searchMore", { count: result.total - result.matches.length })}</p>
      )}
    </div>
  );
}
