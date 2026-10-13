import { useState } from "react";

import { setSampleHidden } from "../api";
import { unitName, useProvinces } from "../data/provinces";
import { useAuth } from "../state/auth";
import { useT, useUi } from "../state/store";
import type { ProvisionalTip } from "../tree/provisional";

interface Props {
  tip: ProvisionalTip;
  onClose(): void;
  /** Mẫu vừa bị ẩn: danh sách tip tạm phải được tải lại. */
  onHidden(): void;
}

/** Chi tiết của một tip tạm. Mọi thứ ở đây do người nộp khai hoặc do Nextclade ước lượng, và được ghi rõ như vậy. */
export function ProvisionalPanel({ tip, onClose, onHidden }: Props) {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const user = useAuth((state) => state.user);
  const provinces = useProvinces();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const hide = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await setSampleHidden(tip.internalId, true);
      onHidden();
    } catch (error) {
      console.error(error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, string | null][] = [
    [t("declaredDate"), tip.collectionDate],
    [t("adminUnit"), unitName(provinces.units, tip.unitCode, lang)],
    [t("host"), tip.host],
    [t("genotype"), tip.clade],
    [t("privateMutations"), t("privateMutationsValue", { count: tip.privateMutations })],
    [t("internalId"), tip.internalId],
  ];

  return (
    <aside className="sample" aria-label={t("provisionalSample")}>
      <header className="sample__header">
        <h2>
          {tip.displayName}
          <span className="tag">{t("provisionalTag")}</span>
        </h2>
        <button type="button" className="quiet" onClick={onClose}>
          {t("close")}
        </button>
      </header>
      <p className="hint">{t("provisionalPanelNote")}</p>
      <dl className="sample__facts">
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd className={value === null ? "muted" : undefined}>{value ?? t("unknown")}</dd>
          </div>
        ))}
      </dl>
      {user?.role === "admin" && (
        <p className="sample__actions">
          <button type="button" className="button" disabled={busy} onClick={() => void hide()}>
            {t("hideSample")}
          </button>
        </p>
      )}
      {failed && (
        <p className="notice" role="alert">
          {t("actionFailed")}
        </p>
      )}
    </aside>
  );
}
