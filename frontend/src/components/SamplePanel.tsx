import { useEffect, useState } from "react";

import { getSample, type SampleDetail } from "../api";
import { useT } from "../state/store";
import type { Column } from "../tree/columns";
import { isoDate } from "../tree/dates";

interface Props {
  internalId: string;
  displayName: string | null;
  /** Ngày của tip trên cây (năm thập phân); khác ngày khai báo khi ngày khai báo không trọn vẹn. */
  treeDate: number;
  unitColumn: Column | null;
  onClose(): void;
}

type Loaded = { id: string; sample: SampleDetail | null; failed: boolean };

/** Chỉ tạo liên kết ra ngoài cho địa chỉ GenBank; `meta` là dữ liệu nhập vào, không phải thứ để tin. */
function genBankUrl(sample: SampleDetail): string | null {
  const url = sample.meta["url"];
  return typeof url === "string" && url.startsWith("https://www.ncbi.nlm.nih.gov/") ? url : null;
}

export function SamplePanel({ internalId, displayName, treeDate, unitColumn, onClose }: Props) {
  const t = useT();
  const [loaded, setLoaded] = useState<Loaded>({ id: "", sample: null, failed: false });

  useEffect(() => {
    const controller = new AbortController();
    getSample(internalId, controller.signal)
      .then((sample) => setLoaded({ id: internalId, sample, failed: false }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setLoaded({ id: internalId, sample: null, failed: true });
        }
      });
    return () => controller.abort();
  }, [internalId]);

  // Kết quả của mẫu trước không được hiện dưới tên của mẫu vừa chọn.
  const current = loaded.id === internalId ? loaded : null;
  const sample = current?.sample ?? null;
  const unitIndex = sample?.unitCode && unitColumn ? unitColumn.values.indexOf(sample.unitCode) : -1;
  const unitLabel = unitIndex >= 0 ? unitColumn!.labels[unitIndex] : (sample?.unitCode ?? null);
  const place = sample ? [sample.location, sample.division].filter(Boolean).join(", ") : "";
  const link = sample ? genBankUrl(sample) : null;

  const rows: [string, string | null][] = sample
    ? [
        [t("accession"), sample.accession],
        [t("collectionDate"), sample.collectionDate],
        [t("inferredDate"), Number.isNaN(treeDate) ? null : isoDate(treeDate)],
        [t("country"), sample.country],
        [t("adminUnit"), unitLabel],
        [t("place"), place || null],
        [t("host"), sample.host],
        [
          t("sequenceLength"),
          sample.sequenceLength === null ? null : t("nucleotides", { count: sample.sequenceLength }),
        ],
        [t("source"), sample.source],
        [t("internalId"), sample.internalId],
      ]
    : [];

  return (
    <aside className="sample" aria-label={t("sample")}>
      <header className="sample__header">
        <h2>{sample?.displayName ?? displayName ?? internalId}</h2>
        <button type="button" className="quiet" onClick={onClose}>
          {t("close")}
        </button>
      </header>

      {!current && <p className="hint">{t("loading")}</p>}
      {current?.failed && <p className="notice">{t("sampleLoadFailed")}</p>}
      {sample && (
        <>
          <dl className="sample__facts">
            {rows.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd className={value === null ? "muted" : undefined}>{value ?? t("unknown")}</dd>
              </div>
            ))}
          </dl>
          {link && (
            <a className="sample__link" href={link} target="_blank" rel="noopener noreferrer">
              {t("viewOnGenBank")}
            </a>
          )}
        </>
      )}
    </aside>
  );
}
