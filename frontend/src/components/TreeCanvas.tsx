import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TipInfo } from "../data/load";
import { useT, useUi } from "../state/store";
import { computeGuides } from "../tree/axis";
import type { Coloring } from "../tree/colors";
import type { Column } from "../tree/columns";
import { isoDate } from "../tree/dates";
import { AXIS_BAND, createScratch, drawTree, tipRadius, type DrawStats, type Scene, type Theme } from "../tree/draw";
import { nodeMask } from "../tree/filter";
import { buildTipGrid, nearestTip } from "../tree/grid";
import { computePositions, type Positions } from "../tree/layout";
import type { Tree } from "../tree/parse";
import {
  MARKER,
  drawProvisional,
  placeProvisional,
  provisionalAt,
  provisionalExtent,
  type Provisional,
  type ProvisionalLayer,
} from "../tree/provisional";
import { clampView, fitView, pan, toWorldX, toWorldY, zoomWithin, type Padding, type View } from "../tree/view";

const THEME: Theme = {
  branch: "#5b6870",
  branchMuted: "#dde2e0",
  missing: "#b9bfc2",
  highlight: "#17242b",
  background: "#fcfcfb",
  guide: "#e9edeb",
  guideText: "#6b7a82",
  font: '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
};

// Lề trên chừa chỗ cho hàng nút phóng to ở góc trên bên trái, nơi nhánh của gốc cây đi qua.
const RECT_PADDING: Padding = { top: 52, right: 28, bottom: AXIS_BAND + 12, left: 16 };
const RADIAL_PADDING: Padding = { top: 28, right: 28, bottom: 28, left: 28 };
/** Bán kính (pixel) quanh con trỏ trong đó một tip được coi là "dưới con trỏ". */
const HIT_RADIUS = 8;
/** Con trỏ đi xa hơn mức này giữa lúc nhấn và lúc thả thì là kéo, không phải bấm. */
const DRAG_THRESHOLD = 4;
const MAX_ZOOM_X = 60;
/** Khi phóng hết cỡ theo chiều dọc, hai tip kề nhau cách nhau chừng này pixel. */
const MAX_TIP_SPACING = 28;

/** Thứ đang dưới con trỏ: một tip của build (`tip`) hoặc một tip tạm (`provisional`), cái còn lại là -1. */
interface Hover {
  tip: number;
  provisional: number;
  x: number;
  y: number;
}

interface Props {
  title: string;
  tree: Tree;
  tips: TipInfo | null;
  /** Mặt nạ tip qua bộ lọc, tính ở trang dataset để cây và chú giải dùng chung một kết quả. */
  tipVisible: Uint8Array;
  visibleCount: number;
  coloring: Coloring | null;
  colorColumn: Column | null;
  colorTitle: string | null;
  /** Các tip tạm của build này; `null` khi không có hoặc chưa tải. */
  provisional: Provisional | null;
  /** Tip tạm nào đang hiện (qua bộ lọc và công tắc ở thanh bên). */
  provisionalVisible: Uint8Array | null;
  /** Tip tạm đang được chọn (chỉ số trong `provisional.tips`), -1 là không chọn. */
  selectedProvisional: number;
  onSelectProvisional(index: number): void;
}

/** Thứ mà test đầu-cuối và harness đo hiệu năng đọc được từ trang. Chỉ đọc, không đổi được trạng thái. */
export interface DebugHook {
  frames: number;
  stats: DrawStats | null;
  /** Thời gian của lần vẽ gần nhất (mili giây), chỉ tính phần vẽ lên canvas. */
  drawMilliseconds: number;
  /** Thời điểm lần vẽ gần nhất kết thúc, theo `performance.now()`. */
  lastDrawAt: number;
  tipCount: number;
  /** Toạ độ của một tip trên trang (pixel của viewport), hoặc `null` nếu nó nằm ngoài canvas. */
  tipPoint(tip: number): { x: number; y: number } | null;
  tipName(tip: number): string;
  isTipVisible(tip: number): boolean;
  /** Số tip tạm được vẽ ở khung hình gần nhất, và toạ độ trên trang của một tip tạm theo mã nội bộ. */
  provisionalDrawn: number;
  provisionalPoint(internalId: string): { x: number; y: number } | null;
}

declare global {
  interface Window {
    __vietstrain?: DebugHook;
  }
}

export function TreeCanvas({
  title,
  tree,
  tips,
  tipVisible,
  visibleCount,
  coloring,
  colorColumn,
  colorTitle,
  provisional,
  provisionalVisible,
  selectedProvisional,
  onSelectProvisional,
}: Props) {
  const t = useT();
  const layout = useUi((state) => state.layout);
  const axis = useUi((state) => state.axis);
  const selectedTip = useUi((state) => state.selectedTip);
  const selectTip = useUi((state) => state.selectTip);

  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef(createScratch());
  const viewRef = useRef<View | null>(null);
  const fitRef = useRef<View | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  /** Cây và bố cục của khung nhìn hiện tại, để biết một lần đổi kích thước có kèm đổi dữ liệu hay không. */
  const shownRef = useRef<{ tree: Tree | null; positions: Positions | null }>({ tree: null, positions: null });
  const hoverRef = useRef(-1);
  const hoverProvisionalRef = useRef(-1);
  const provisionalDrawnRef = useRef(0);
  const pendingRef = useRef(0);
  const statsRef = useRef<DrawStats | null>(null);
  const framesRef = useRef(0);
  const drawMsRef = useRef(0);
  const drawnAtRef = useRef(0);
  const dragRef = useRef<{ x: number; y: number; moved: boolean; pointer: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Vị trí và lưới tìm tip chỉ phụ thuộc cây, bố cục và trục; phóng to hay lọc không tính lại chúng.
  // Trục chừa chỗ cho mọi tip tạm đã tải, dù đang hiện hay ẩn: bật tắt chúng không làm cây co giãn.
  const extent = useMemo(() => provisionalExtent(provisional, axis), [provisional, axis]);
  const positions = useMemo(() => computePositions(tree, layout, axis, extent), [tree, layout, axis, extent]);
  const provisionalPositions = useMemo(
    () => (provisional ? placeProvisional(tree, positions, provisional) : null),
    [tree, positions, provisional],
  );
  const grid = useMemo(() => buildTipGrid(tree, positions), [tree, positions]);
  const nodeVisible = useMemo(() => nodeMask(tree, tipVisible), [tree, tipVisible]);
  const padding = layout === "rect" ? RECT_PADDING : RADIAL_PADDING;

  /** Số lần được phóng tối đa theo từng chiều, so với mức vừa khít cả cây. */
  const maxZoom = useCallback((): [number, number] => {
    const fit = fitRef.current;
    if (!fit || layout === "radial") return [MAX_ZOOM_X, MAX_ZOOM_X];
    return [MAX_ZOOM_X, Math.max(1, (MAX_TIP_SPACING * Math.max(1, tree.tipCount - 1)) / fit.scaleY)];
  }, [layout, tree]);

  const scene = useCallback((): Scene | null => {
    const view = viewRef.current;
    const { width, height } = sizeRef.current;
    if (!view || width === 0 || height === 0) return null;
    return {
      tree,
      positions,
      view,
      width,
      height,
      tipVisible,
      nodeVisible,
      tipCodes: coloring?.tipSlots ?? null,
      nodeCodes: coloring?.nodeSlots ?? null,
      colors: coloring?.colors ?? [],
      theme: THEME,
      hoverTip: hoverRef.current,
      selectedTip,
      guides: computeGuides(positions, view, width, padding),
    };
  }, [tree, positions, tipVisible, nodeVisible, coloring, selectedTip, padding]);

  const provisionalLayer = useCallback((): ProvisionalLayer | null => {
    if (!provisionalPositions || !provisionalVisible) return null;
    return {
      positions: provisionalPositions,
      visible: provisionalVisible,
      hover: hoverProvisionalRef.current,
      selected: selectedProvisional,
    };
  }, [provisionalPositions, provisionalVisible, selectedProvisional]);

  const draw = useCallback(() => {
    pendingRef.current = 0;
    const canvas = canvasRef.current;
    const current = scene();
    if (!canvas || !current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const started = performance.now();
    statsRef.current = drawTree(ctx, current, scratchRef.current);
    const layer = provisionalLayer();
    // Tip tạm được vẽ đè lên cây; phần nằm dưới dải nhãn trục của bố cục chữ nhật thì bỏ.
    const bottom = current.guides?.kind === "lines" ? current.height - AXIS_BAND : current.height;
    provisionalDrawnRef.current = layer
      ? drawProvisional(ctx, current.view, layer, { ink: THEME.highlight, background: THEME.background }, bottom)
      : 0;
    drawnAtRef.current = performance.now();
    drawMsRef.current = drawnAtRef.current - started;
    framesRef.current += 1;
    if (framesRef.current === 1) {
      performance.mark("vietstrain:first-frame");
      // Khung hình kế tiếp bắt đầu nghĩa là khung hình đầu đã được trình duyệt đưa lên màn hình.
      requestAnimationFrame(() => performance.mark("vietstrain:first-frame-presented"));
    }
  }, [scene, provisionalLayer]);

  /** Gom mọi yêu cầu vẽ trong một khung hình thành một lần vẽ. */
  const requestDraw = useCallback(() => {
    if (pendingRef.current === 0) pendingRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Theo dõi kích thước khung: canvas luôn khớp với pixel thật của màn hình.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => {
      const width = Math.floor(frame.clientWidth);
      const height = Math.floor(frame.clientHeight);
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Đổi kích thước, bố cục hay trục: đặt lại khung nhìn cho vừa cả cây.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const previous = sizeRef.current;
    const view = viewRef.current;
    const sameTree = shownRef.current.tree === tree && shownRef.current.positions === positions;
    sizeRef.current = size;
    shownRef.current = { tree, positions };
    fitRef.current = fitView(size.width, size.height, padding, layout);
    if (sameTree && view && previous.width > 0) {
      // Chỉ kích thước đổi (mở bảng chi tiết, đổi cỡ cửa sổ): giữ nguyên vùng của cây đang được xem.
      const box = {
        x0: toWorldX(view, padding.left),
        x1: toWorldX(view, previous.width - padding.right),
        y0: toWorldY(view, padding.top),
        y1: toWorldY(view, previous.height - padding.bottom),
      };
      viewRef.current = clampView(fitView(size.width, size.height, padding, layout, box), fitRef.current, ...maxZoom());
    } else {
      viewRef.current = fitRef.current;
    }
    hoverRef.current = -1;
    hoverProvisionalRef.current = -1;
    setHover(null);
  }, [size, layout, padding, tree, positions, maxZoom]);

  // Mọi thay đổi của dữ liệu vẽ (lọc, màu, tip được chọn, khung nhìn mới) dẫn tới một lần vẽ lại.
  useEffect(() => {
    requestDraw();
    return () => {
      if (pendingRef.current !== 0) cancelAnimationFrame(pendingRef.current);
      pendingRef.current = 0;
    };
  }, [requestDraw, size]);

  const pixelOfTip = useCallback(
    (tip: number): { x: number; y: number } | null => {
      const view = viewRef.current;
      if (!view || tip < 0 || tip >= tree.tipCount) return null;
      const node = tree.tipNode[tip];
      return {
        x: view.offsetX + positions.x[node] * view.scaleX,
        y: view.offsetY + positions.y[node] * view.scaleY,
      };
    },
    [tree, positions],
  );

  const tipAt = useCallback(
    (x: number, y: number): number => {
      const view = viewRef.current;
      if (!view) return -1;
      return nearestTip(
        grid,
        tree,
        positions,
        toWorldX(view, x),
        toWorldY(view, y),
        HIT_RADIUS / view.scaleX,
        HIT_RADIUS / view.scaleY,
        tipVisible,
      );
    },
    [grid, tree, positions, tipVisible],
  );

  const pixelOfProvisional = useCallback(
    (index: number): { x: number; y: number } | null => {
      const view = viewRef.current;
      if (!view || !provisionalPositions || index < 0 || index >= provisionalPositions.x.length) return null;
      return {
        x: view.offsetX + provisionalPositions.x[index] * view.scaleX,
        y: view.offsetY + provisionalPositions.y[index] * view.scaleY,
      };
    },
    [provisionalPositions],
  );

  /** Tip tạm dưới điểm (x, y) của canvas; -1 nếu không có. Tip tạm được xét trước tip của build. */
  const provisionalUnder = useCallback(
    (x: number, y: number): number => {
      const view = viewRef.current;
      const layer = provisionalLayer();
      return view && layer ? provisionalAt(layer, view, x, y, HIT_RADIUS) : -1;
    },
    [provisionalLayer],
  );

  const showHover = useCallback(
    (tip: number, provisionalIndex = -1) => {
      if (tip === hoverRef.current && provisionalIndex === hoverProvisionalRef.current) return;
      hoverRef.current = tip;
      hoverProvisionalRef.current = provisionalIndex;
      const point = provisionalIndex >= 0 ? pixelOfProvisional(provisionalIndex) : pixelOfTip(tip);
      setHover((tip >= 0 || provisionalIndex >= 0) && point ? { tip, provisional: provisionalIndex, ...point } : null);
      requestDraw();
    },
    [pixelOfTip, pixelOfProvisional, requestDraw],
  );

  const setView = useCallback(
    (next: View) => {
      const fit = fitRef.current;
      viewRef.current = fit ? clampView(next, fit, ...maxZoom()) : next;
      // Tooltip gắn với vị trí cũ của tip; bỏ nó khi khung nhìn đổi.
      if (hoverRef.current !== -1 || hoverProvisionalRef.current !== -1) {
        hoverRef.current = -1;
        hoverProvisionalRef.current = -1;
        setHover(null);
      }
      requestDraw();
    },
    [maxZoom, requestDraw],
  );

  const zoomBy = useCallback(
    (factor: number, x?: number, y?: number, horizontal = false) => {
      const view = viewRef.current;
      const fit = fitRef.current;
      if (!view || !fit) return;
      const { width, height } = sizeRef.current;
      const px = x ?? width / 2;
      const py = y ?? height / 2;
      // Bố cục toả tròn phóng đều hai chiều; bố cục chữ nhật phóng một chiều mỗi lần.
      const factorX = layout === "radial" || horizontal ? factor : 1;
      const factorY = layout === "radial" || !horizontal ? factor : 1;
      setView(zoomWithin(view, fit, px, py, factorX, factorY, ...maxZoom()));
    },
    [layout, maxZoom, setView],
  );

  const resetView = useCallback(() => {
    if (fitRef.current) setView(fitRef.current);
  }, [setView]);

  // Sự kiện lăn chuột phải đăng ký không thụ động thì mới chặn được việc cuộn trang.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      zoomBy(Math.exp(-lines * 0.0015), event.clientX - box.left, event.clientY - box.top, event.shiftKey);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // Cửa nhìn cho test đầu-cuối và harness đo hiệu năng.
  useEffect(() => {
    window.__vietstrain = {
      get frames() {
        return framesRef.current;
      },
      get stats() {
        return statsRef.current;
      },
      get drawMilliseconds() {
        return drawMsRef.current;
      },
      get lastDrawAt() {
        return drawnAtRef.current;
      },
      tipCount: tree.tipCount,
      tipPoint(tip) {
        const point = pixelOfTip(tip);
        const canvas = canvasRef.current;
        if (!point || !canvas) return null;
        const box = canvas.getBoundingClientRect();
        if (point.x < 0 || point.y < 0 || point.x > box.width || point.y > box.height - AXIS_BAND) return null;
        return { x: box.left + point.x, y: box.top + point.y };
      },
      tipName: (tip) => tree.tipNames[tip] ?? "",
      isTipVisible: (tip) => tipVisible[tip] === 1,
      get provisionalDrawn() {
        return provisionalDrawnRef.current;
      },
      provisionalPoint(internalId) {
        const index = provisional?.tips.findIndex((one) => one.internalId === internalId) ?? -1;
        const point = pixelOfProvisional(index);
        const canvas = canvasRef.current;
        if (!point || !canvas || provisionalVisible?.[index] !== 1) return null;
        const box = canvas.getBoundingClientRect();
        if (point.x < 0 || point.y < 0 || point.x > box.width || point.y > box.height) return null;
        return { x: box.left + point.x, y: box.top + point.y };
      },
    };
    return () => {
      delete window.__vietstrain;
    };
  }, [tree, pixelOfTip, tipVisible, provisional, provisionalVisible, pixelOfProvisional]);

  const local = (event: { clientX: number; clientY: number }) => {
    const box = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { ...local(event), moved: false, pointer: event.pointerId };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = local(event);
    const drag = dragRef.current;
    if (drag && drag.pointer === event.pointerId) {
      const dx = point.x - drag.x;
      const dy = point.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.x = point.x;
      drag.y = point.y;
      if (viewRef.current) setView(pan(viewRef.current, dx, dy));
      return;
    }
    const over = provisionalUnder(point.x, point.y);
    if (over >= 0) showHover(-1, over);
    else showHover(tipAt(point.x, point.y));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.pointer !== event.pointerId || drag.moved) return;
    const point = local(event);
    const over = provisionalUnder(point.x, point.y);
    if (over >= 0) onSelectProvisional(over);
    else selectTip(tipAt(point.x, point.y));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    const step = 60;
    const actions: Record<string, () => void> = {
      "+": () => zoomBy(1.4),
      "=": () => zoomBy(1.4),
      "-": () => zoomBy(1 / 1.4),
      "0": resetView,
      ArrowUp: () => setView(pan(view, 0, step)),
      ArrowDown: () => setView(pan(view, 0, -step)),
      ArrowLeft: () => setView(pan(view, step, 0)),
      ArrowRight: () => setView(pan(view, -step, 0)),
      Escape: () => selectTip(-1),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const tooltip = useMemo(() => {
    if (!hover) return null;
    if (hover.provisional >= 0) {
      const one = provisional?.tips[hover.provisional];
      if (!one) return null;
      return {
        name: one.displayName,
        date: one.collectionDate,
        value: t("privateMutationsValue", { count: one.privateMutations }),
        swatch: null,
        tag: t("provisionalTag"),
      };
    }
    const node = tree.tipNode[hover.tip];
    const date = tree.numDate[node];
    const code = colorColumn ? colorColumn.tipCodes[hover.tip] : -1;
    return {
      name: tips?.displayName[hover.tip] ?? tree.tipNames[hover.tip],
      date: tips?.collectionDate[hover.tip] ?? (Number.isNaN(date) ? null : isoDate(date)),
      value: colorColumn ? (code >= 0 ? colorColumn.labels[code] : t("missingValue")) : null,
      swatch: coloring && code >= 0 ? coloring.colors[coloring.slotOfValue[code]] : null,
      tag: null,
    };
  }, [hover, tree, tips, colorColumn, coloring, provisional, t]);

  const tipSize = viewRef.current ? tipRadius({ tree, positions, view: viewRef.current }) : 3;
  const radius = hover !== null && hover.provisional >= 0 ? MARKER + 2 : tipSize;
  // Tooltip nằm bên phải tip, lật sang trái khi gần mép phải.
  const flip = hover !== null && hover.x > size.width - 260;

  return (
    <div className="tree" ref={frameRef}>
      <canvas
        ref={canvasRef}
        className="tree__canvas"
        style={{ width: size.width, height: size.height }}
        role="img"
        aria-label={t("treeLabel", { title })}
        aria-describedby="tree-help"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => showHover(-1)}
        onDoubleClick={resetView}
        onKeyDown={onKeyDown}
      />
      <p id="tree-help" className="visually-hidden">
        {t("treeHelp")}
      </p>

      <div className="tree__zoom" role="group" aria-label={t("zoomReset")}>
        <button type="button" onClick={() => zoomBy(1.6)} aria-label={t("zoomIn")} title={t("zoomIn")}>
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label={t("zoomOut")} title={t("zoomOut")}>
          −
        </button>
        <button type="button" className="tree__zoom-reset" onClick={resetView}>
          {t("zoomReset")}
        </button>
      </div>

      {visibleCount === 0 && <p className="tree__empty">{t("noSamplesMatch")}</p>}

      {hover && tooltip && (
        <div
          className={flip ? "tooltip tooltip--left" : "tooltip"}
          role="status"
          style={{ left: hover.x + (flip ? -(radius + 10) : radius + 10), top: hover.y }}
        >
          <strong className="tooltip__name">
            {tooltip.name}
            {tooltip.tag && <span className="tag">{tooltip.tag}</span>}
          </strong>
          {tooltip.date && <span>{tooltip.date}</span>}
          {tooltip.value !== null && (
            <span className="tooltip__value">
              {tooltip.swatch && <i className="swatch" style={{ background: tooltip.swatch }} />}
              {tooltip.tag ? tooltip.value : `${colorTitle}: ${tooltip.value}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
