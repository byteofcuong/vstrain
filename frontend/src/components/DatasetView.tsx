import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ApiError, getDataset, getPlacements, type DatasetInfo, type Placements } from "../api";
import { DatasetSession } from "../data/session";
import { useMapData } from "../map/load";
import { selectionMask } from "../map/placement";
import { useT, useUi } from "../state/store";
import { colorize } from "../tree/colors";
import { countSet, hasFilters, intersect, tipMask } from "../tree/filter";
import { attachProvisional, provisionalMask } from "../tree/provisional";
import { MapPanel } from "./MapPanel";
import { ProvisionalPanel } from "./ProvisionalPanel";
import { SamplePanel } from "./SamplePanel";
import { Sidebar } from "./Sidebar";
import { TreeCanvas } from "./TreeCanvas";

type Lookup =
  | { state: "loading" }
  | { state: "found"; dataset: DatasetInfo }
  | { state: "missing" }
  | { state: "failed"; message: string };

/** Các tip tạm của dataset: đang tải, đã có, hoặc tải không được (cây vẫn xem được, chỉ thiếu tip tạm). */
type PlacementsState = { state: "loading" } | ({ state: "ready" } & Placements) | { state: "error" };

/** Chờ danh sách tip tạm lâu nhất bấy nhiêu mili giây rồi vẽ cây mà không có chúng. */
const PLACEMENTS_TIMEOUT = 3000;

/** Cột được tô màu khi vừa mở dataset: genotype nếu có, không thì cột đầu tiên. */
const PREFERRED_COLOR = "clade";

/** Các cột mà bản đồ đọc: mã tỉnh, mã vùng hoặc miền, và quốc gia (để biết mẫu nào của Việt Nam). */
const MAP_COLUMNS = ["unit", "region", "country"];

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

interface OpenProps {
  session: DatasetSession;
  placements: PlacementsState;
  onReloadPlacements(): void;
  /** Mã nội bộ của mẫu mà địa chỉ trang chỉ vào; được chọn sẵn khi cây mở. */
  wantedTip: string | null;
}

function OpenDataset({ session, placements, onReloadPlacements, wantedTip }: OpenProps) {
  const t = useT();
  const lang = useUi((state) => state.lang);
  const colorKey = useUi((state) => state.colorKey);
  const filters = useUi((state) => state.filters);
  const selectedTip = useUi((state) => state.selectedTip);
  const selectedProvisional = useUi((state) => state.selectedProvisional);
  const showProvisional = useUi((state) => state.showProvisional);
  const selectProvisional = useUi((state) => state.selectProvisional);
  const mapWanted = useUi((state) => state.mapOpen);
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

  // Bản đồ chỉ có nghĩa với dataset có cột địa bàn. Bộ lọc theo địa bàn chỉ đặt được từ bản đồ đã tải xong, nên
  // hình học và các cột của nó luôn đã có sẵn khi bộ lọc đó tồn tại, kể cả sau khi bảng bản đồ bị ẩn đi.
  const hasGeo = manifest?.columns.some((column) => column.key === "unit" || column.key === "region") ?? false;
  const mapOpen = mapWanted && hasGeo;
  // Hình học chỉ bắt đầu tải khi cây đã về: bản đồ không tranh mạng và main thread với khung hình đầu của cây.
  const map = useMapData(mapOpen && tree !== null);

  // Tải những cột đang cần: cột tô màu, các cột đang lọc, cột tỉnh cho bảng chi tiết mẫu, và các cột của bản đồ.
  useEffect(() => {
    if (!manifest || !tree) return;
    const known = new Set(manifest.columns.map((column) => column.key));
    for (const key of [colorKey, ...Object.keys(filters.values), "unit", ...(mapOpen ? MAP_COLUMNS : [])]) {
      if (key && known.has(key)) session.requestColumn(key);
    }
  }, [session, manifest, tree, colorKey, filters.values, mapOpen]);

  const colorColumn = colorKey ? (columns.get(colorKey) ?? null) : null;
  const coloring = useMemo(() => (colorColumn ? colorize(colorColumn) : null), [colorColumn]);
  const unitColumn = columns.get("unit") ?? null;
  const regionColumn = columns.get("region") ?? null;
  // Bản đồ đọc mẫu nằm ở đâu từ các cột này. Thiếu một cột thì mọi con số của nó đều sai, nên nó chờ đủ cột.
  const mapKeys = MAP_COLUMNS.filter((key) => manifest?.columns.some((column) => column.key === key));
  const failedMapKeys = mapKeys.filter((key) => columnErrors.has(key));
  const placesState =
    failedMapKeys.length > 0 ? "error" : mapKeys.every((key) => columns.has(key)) ? "ready" : "loading";
  // Mặt nạ của bộ lọc theo địa bàn; `null` khi không lọc, hoặc khi hình học hay các cột của bản đồ chưa tải xong.
  const areaTips = useMemo(
    () =>
      filters.area && map.data && placesState === "ready"
        ? selectionMask(map.data, filters.area, unitColumn, regionColumn)
        : null,
    [filters.area, map.data, placesState, unitColumn, regionColumn],
  );
  const tipVisible = useMemo(() => {
    if (!tree) return new Uint8Array(0);
    const mask = tipMask(tree, columns, filters);
    return areaTips && areaTips.length === mask.length ? intersect(mask, areaTips) : mask;
  }, [tree, columns, filters, areaTips]);
  const visibleCount = useMemo(() => countSet(tipVisible), [tipVisible]);

  // Tip tạm chỉ có nghĩa với cây của đúng build mà chúng được gắn vào: build của trang khác đi thì bỏ qua.
  const provisional = useMemo(() => {
    if (!tree || !manifest || placements.state !== "ready" || placements.buildId !== manifest.build.id) return null;
    const attached = attachProvisional(tree, placements.items);
    return attached.tips.length > 0 ? attached : null;
  }, [tree, manifest, placements]);
  const provisionalVisible = useMemo(() => {
    if (!provisional) return null;
    return showProvisional ? provisionalMask(provisional, filters) : new Uint8Array(provisional.tips.length);
  }, [provisional, showProvisional, filters]);
  const provisionalIndex = provisional
    ? provisional.tips.findIndex((one) => one.internalId === selectedProvisional)
    : -1;

  // Địa chỉ trang chỉ vào một mẫu: chọn nó khi cây và các tip tạm đã về. Mẫu đã thành tip chính thức thì chọn
  // tip đó.
  useEffect(() => {
    if (!wantedTip || !tree || placements.state === "loading") return;
    if (provisional?.tips.some((one) => one.internalId === wantedTip)) selectProvisional(wantedTip);
    else if (tree.tipNames.includes(wantedTip)) selectTip(tree.tipNames.indexOf(wantedTip));
  }, [wantedTip, tree, placements.state, provisional, selectProvisional, selectTip]);

  if (data.status === "error") {
    return (
      <Message>
        {t("loadFailed")}: {data.error}
      </Message>
    );
  }
  // Khung hình đầu được vẽ khi đã biết các tip tạm, để trục không co giãn ngay sau khi cây hiện ra.
  if (!manifest || !tree || placements.state === "loading") return <Message>{t("loadingTree")}</Message>;

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
        map={map.data}
        mapAvailable={hasGeo}
        provisional={{
          failed: placements.state === "error",
          total: provisional?.tips.length ?? 0,
          filteredOut: provisional !== null && hasFilters({ ...filters, dateFrom: null, dateTo: null }),
          onRetry: onReloadPlacements,
        }}
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
          provisional={provisional}
          provisionalVisible={provisionalVisible}
          selectedProvisional={provisionalIndex}
          onSelectProvisional={(index) => selectProvisional(provisional?.tips[index]?.internalId ?? null)}
        />
        {(selected >= 0 || provisionalIndex >= 0 || mapOpen) && (
          // Một cột bên phải cho cả hai: chi tiết của mẫu đang chọn nằm trên, bản đồ nằm dưới.
          <div className="context">
            {selected >= 0 && (
              <SamplePanel
                internalId={tree.tipNames[selected]}
                displayName={tips?.displayName[selected] ?? null}
                treeDate={tree.numDate[tree.tipNode[selected]]}
                unitColumn={unitColumn}
                onClose={() => selectTip(-1)}
              />
            )}
            {provisional && provisionalIndex >= 0 && (
              <ProvisionalPanel
                tip={provisional.tips[provisionalIndex]}
                onClose={() => selectProvisional(null)}
                onHidden={() => {
                  selectProvisional(null);
                  onReloadPlacements();
                }}
              />
            )}
            {mapOpen && (
              <MapPanel
                state={map}
                onRetry={map.retry}
                places={placesState}
                onRetryPlaces={() => failedMapKeys.forEach((key) => session.requestColumn(key))}
                unit={unitColumn}
                region={regionColumn}
                country={columns.get("country") ?? null}
                tipVisible={tipVisible}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export function DatasetView({ slug, tip }: { slug: string; tip: string | null }) {
  const t = useT();
  const resetForDataset = useUi((state) => state.resetForDataset);
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<DatasetSession | null>(null);
  const [placements, setPlacements] = useState<PlacementsState>({ state: "loading" });
  const [placementsAttempt, setPlacementsAttempt] = useState(0);
  const askedFor = useRef<string | null>(null);

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

  // Các tip tạm được hỏi song song với việc tải cây. Hỏi không được, hoặc quá lâu, thì cây vẫn được vẽ.
  useEffect(() => {
    if (!manifestUrl) return;
    const controller = new AbortController();
    let current = true;
    const timer = window.setTimeout(() => controller.abort(), PLACEMENTS_TIMEOUT);
    // Chỉ lần hỏi đầu của một bản publish mới giữ cây lại chờ. Hỏi lại (sau khi ẩn một mẫu, hay bấm thử lại) thì cây
    // đang xem vẫn đứng yên cho tới khi có câu trả lời mới.
    if (askedFor.current !== manifestUrl) setPlacements({ state: "loading" });
    askedFor.current = manifestUrl;
    getPlacements(slug, controller.signal)
      .then((found) => current && setPlacements({ state: "ready", ...found }))
      .catch((error: unknown) => {
        if (!current) return;
        console.error(error);
        setPlacements({ state: "error" });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      current = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [slug, manifestUrl, placementsAttempt]);

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
  return (
    <OpenDataset
      session={session}
      placements={placements}
      onReloadPlacements={() => setPlacementsAttempt((count) => count + 1)}
      wantedTip={tip}
    />
  );
}
