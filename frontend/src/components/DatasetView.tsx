import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { ApiError, getDataset, type DatasetInfo } from "../api";
import { DatasetSession } from "../data/session";
import { useT, useUi } from "../state/store";
import { colorize } from "../tree/colors";
import { countSet, tipMask } from "../tree/filter";
import { SamplePanel } from "./SamplePanel";
import { Sidebar } from "./Sidebar";
import { TreeCanvas } from "./TreeCanvas";

type Lookup =
  | { state: "loading" }
  | { state: "found"; dataset: DatasetInfo }
  | { state: "missing" }
  | { state: "failed"; message: string };

/** Cột được tô màu khi vừa mở dataset: genotype nếu có, không thì cột đầu tiên. */
const PREFERRED_COLOR = "clade";

function Message({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="message">
      <p>{children}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          {t("retry")}
        </button>
      )}
    </div>
  );
}

function OpenDataset({ session }: { session: DatasetSession }) {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const colorKey = useUi((state) => state.colorKey);
  const filters = useUi((state) => state.filters);
  const selectedTip = useUi((state) => state.selectedTip);
  const setColorKey = useUi((state) => state.setColorKey);
  const selectTip = useUi((state) => state.selectTip);
  const data = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { manifest, tree, tips, columns, columnErrors } = data;

  // Vừa có manifest: chọn cột tô màu mặc định.
  useEffect(() => {
    if (!manifest) return;
    const keys = manifest.columns.map((column) => column.key);
    setColorKey(keys.includes(PREFERRED_COLOR) ? PREFERRED_COLOR : (keys[0] ?? null));
  }, [manifest, setColorKey]);

  // Tải những cột đang cần: cột tô màu, các cột đang lọc, và cột tỉnh cho bảng chi tiết mẫu.
  useEffect(() => {
    if (!manifest || !tree) return;
    const known = new Set(manifest.columns.map((column) => column.key));
    for (const key of [colorKey, ...Object.keys(filters.values), "unit"]) {
      if (key && known.has(key)) session.requestColumn(key);
    }
  }, [session, manifest, tree, colorKey, filters.values]);

  const colorColumn = colorKey ? (columns.get(colorKey) ?? null) : null;
  const coloring = useMemo(() => (colorColumn ? colorize(colorColumn) : null), [colorColumn]);
  const tipVisible = useMemo(
    () => (tree ? tipMask(tree, columns, filters) : new Uint8Array(0)),
    [tree, columns, filters],
  );
  const visibleCount = useMemo(() => countSet(tipVisible), [tipVisible]);

  if (data.status === "error") {
    return (
      <Message>
        {t("loadFailed")}: {data.error}
      </Message>
    );
  }
  if (!manifest || !tree) return <Message>{t("loadingTree")}</Message>;

  const colorTitle = manifest.columns.find((column) => column.key === colorKey)?.title[lang] ?? null;
  const selected = selectedTip >= 0 && selectedTip < tree.tipCount ? selectedTip : -1;

  return (
    <div className="workspace">
      <Sidebar
        manifest={manifest}
        tree={tree}
        tips={tips}
        columns={columns}
        colorColumn={colorColumn}
        coloring={coloring}
        colorError={colorKey !== null && columnErrors.has(colorKey)}
        onRetryColor={() => colorKey !== null && session.requestColumn(colorKey)}
        tipVisible={tipVisible}
        visibleCount={visibleCount}
      />
      <main className="stage">
        <TreeCanvas
          title={manifest.dataset.title}
          tree={tree}
          tips={tips}
          tipVisible={tipVisible}
          visibleCount={visibleCount}
          coloring={coloring}
          colorColumn={colorColumn}
          colorTitle={colorTitle}
        />
        {selected >= 0 && (
          <SamplePanel
            internalId={tree.tipNames[selected]}
            displayName={tips?.displayName[selected] ?? null}
            treeDate={tree.numDate[tree.tipNode[selected]]}
            unitColumn={columns.get("unit") ?? null}
            onClose={() => selectTip(-1)}
          />
        )}
      </main>
    </div>
  );
}

export function DatasetView({ slug }: { slug: string }) {
  const t = useT();
  const resetForDataset = useUi((state) => state.resetForDataset);
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<DatasetSession | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLookup({ state: "loading" });
    resetForDataset();
    getDataset(slug, controller.signal)
      .then((dataset) => setLookup({ state: "found", dataset }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) setLookup({ state: "missing" });
        else setLookup({ state: "failed", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [slug, attempt, resetForDataset]);

  const manifestUrl = lookup.state === "found" ? (lookup.dataset.currentBuild?.manifestUrl ?? null) : null;

  // Mỗi bản publish một phiên (một worker); đóng phiên cũ khi rời trang hoặc khi có bản publish khác.
  useEffect(() => {
    if (!manifestUrl) {
      setSession(null);
      return;
    }
    const opened = new DatasetSession(manifestUrl);
    setSession(opened);
    return () => opened.dispose();
  }, [manifestUrl]);

  if (lookup.state === "loading") return <Message>{t("loading")}</Message>;
  if (lookup.state === "missing") return <Message>{t("datasetNotFound")}</Message>;
  if (lookup.state === "failed") {
    return (
      <Message onRetry={() => setAttempt((count) => count + 1)}>
        {t("loadFailed")}: {lookup.message}
      </Message>
    );
  }
  if (!manifestUrl) return <Message>{t("datasetNotBuilt")}</Message>;
  if (!session) return <Message>{t("loadingTree")}</Message>;
  return <OpenDataset session={session} />;
}
