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

const RECT_PADDING: Padding = { top: 16, right: 28, bottom: AXIS_BAND + 12, left: 16 };
const RADIAL_PADDING: Padding = { top: 28, right: 28, bottom: 28, left: 28 };
/** Bán kính (pixel) quanh con trỏ trong đó một tip được coi là "dưới con trỏ". */
const HIT_RADIUS = 8;
/** Con trỏ đi xa hơn mức này giữa lúc nhấn và lúc thả thì là kéo, không phải bấm. */
const DRAG_THRESHOLD = 4;
const MAX_ZOOM_X = 60;
/** Khi phóng hết cỡ theo chiều dọc, hai tip kề nhau cách nhau chừng này pixel. */
const MAX_TIP_SPACING = 28;

interface Hover {
  tip: number;
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
}

/** Thứ mà test đầu-cuối và harness đo hiệu năng đọc được từ trang. Chỉ đọc, không đổi được trạng thái. */
export interface DebugHook {
  frames: number;
  stats: DrawStats | null;
  /** Thời gian của lần vẽ gần nhất (mili giây), chỉ tính phần vẽ lên canvas. */
  drawMilliseconds: number;
  tipCount: number;
  /** Toạ độ của một tip trên trang (pixel của viewport), hoặc `null` nếu nó nằm ngoài canvas. */
  tipPoint(tip: number): { x: number; y: number } | null;
  tipName(tip: number): string;
  isTipVisible(tip: number): boolean;
}

declare global {
  interface Window {
    __vietstrain?: DebugHook;
  }
}

export function TreeCanvas({ title, tree, tips, tipVisible, visibleCount, coloring, colorColumn, colorTitle }: Props) {
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
  const pendingRef = useRef(0);
  const statsRef = useRef<DrawStats | null>(null);
  const framesRef = useRef(0);
  const drawMsRef = useRef(0);
  const dragRef = useRef<{ x: number; y: number; moved: boolean; pointer: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Vị trí và lưới tìm tip chỉ phụ thuộc cây, bố cục và trục; phóng to hay lọc không tính lại chúng.
  const positions = useMemo(() => computePositions(tree, layout, axis), [tree, layout, axis]);
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
    drawMsRef.current = performance.now() - started;
    framesRef.current += 1;
    if (framesRef.current === 1) performance.mark("vietstrain:first-frame");
  }, [scene]);

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

  const showHover = useCallback(
    (tip: number) => {
      if (tip === hoverRef.current) return;
      hoverRef.current = tip;
      const point = pixelOfTip(tip);
      setHover(tip >= 0 && point ? { tip, ...point } : null);
      requestDraw();
    },
    [pixelOfTip, requestDraw],
  );

  const setView = useCallback(
    (next: View) => {
      const fit = fitRef.current;
      viewRef.current = fit ? clampView(next, fit, ...maxZoom()) : next;
      // Tooltip gắn với vị trí cũ của tip; bỏ nó khi khung nhìn đổi.
      if (hoverRef.current !== -1) {
        hoverRef.current = -1;
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
    };
    return () => {
      delete window.__vietstrain;
    };
  }, [tree, pixelOfTip, tipVisible]);

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
    showHover(tipAt(point.x, point.y));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.pointer !== event.pointerId || drag.moved) return;
    const point = local(event);
    selectTip(tipAt(point.x, point.y));
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
    const node = tree.tipNode[hover.tip];
    const date = tree.numDate[node];
    const code = colorColumn ? colorColumn.tipCodes[hover.tip] : -1;
    return {
      name: tips?.displayName[hover.tip] ?? tree.tipNames[hover.tip],
      date: tips?.collectionDate[hover.tip] ?? (Number.isNaN(date) ? null : isoDate(date)),
      value: colorColumn ? (code >= 0 ? colorColumn.labels[code] : t("missingValue")) : null,
      swatch: coloring && code >= 0 ? coloring.colors[coloring.slotOfValue[code]] : null,
    };
  }, [hover, tree, tips, colorColumn, coloring, t]);

  const radius = viewRef.current ? tipRadius({ tree, positions, view: viewRef.current }) : 3;
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
          <strong className="tooltip__name">{tooltip.name}</strong>
          {tooltip.date && <span>{tooltip.date}</span>}
          {tooltip.value !== null && (
            <span className="tooltip__value">
              {tooltip.swatch && <i className="swatch" style={{ background: tooltip.swatch }} />}
              {colorTitle}: {tooltip.value}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
