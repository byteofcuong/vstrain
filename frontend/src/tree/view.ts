import type { Layout } from "./layout";

/** Phép biến đổi từ hệ toạ độ cây sang pixel của canvas: `px = offsetX + x * scaleX`. */
export interface View {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const WHOLE_TREE: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** Phép biến đổi đặt vừa một vùng của cây vào canvas. Bố cục toả tròn giữ tỉ lệ hai chiều bằng nhau. */
export function fitView(width: number, height: number, padding: Padding, layout: Layout, box: Box = WHOLE_TREE): View {
  const innerWidth = Math.max(1, width - padding.left - padding.right);
  const innerHeight = Math.max(1, height - padding.top - padding.bottom);
  const boxWidth = Math.max(box.x1 - box.x0, 1e-9);
  const boxHeight = Math.max(box.y1 - box.y0, 1e-9);
  let scaleX = innerWidth / boxWidth;
  let scaleY = innerHeight / boxHeight;
  if (layout === "radial") scaleX = scaleY = Math.min(scaleX, scaleY);
  return {
    scaleX,
    scaleY,
    // Căn giữa phần còn thừa, có ích khi hai tỉ lệ bị ép bằng nhau.
    offsetX: padding.left + (innerWidth - boxWidth * scaleX) / 2 - box.x0 * scaleX,
    offsetY: padding.top + (innerHeight - boxHeight * scaleY) / 2 - box.y0 * scaleY,
  };
}

/** Phóng to hoặc thu nhỏ quanh một điểm của canvas: điểm của cây nằm dưới con trỏ đứng yên. */
export function zoomAt(view: View, px: number, py: number, factorX: number, factorY: number): View {
  return {
    scaleX: view.scaleX * factorX,
    scaleY: view.scaleY * factorY,
    offsetX: px - (px - view.offsetX) * factorX,
    offsetY: py - (py - view.offsetY) * factorY,
  };
}

/**
 * Như `zoomAt`, nhưng dừng ở giới hạn phóng của từng chiều (từ mức vừa khít tới `maxZoom` lần mức đó).
 * Hệ số được cắt trước khi áp dụng, nên điểm dưới con trỏ vẫn đứng yên khi chạm giới hạn.
 */
export function zoomWithin(
  view: View,
  fit: View,
  px: number,
  py: number,
  factorX: number,
  factorY: number,
  maxZoomX: number,
  maxZoomY = maxZoomX,
): View {
  const limited = (factor: number, scale: number, fitScale: number, maxZoom: number) =>
    Math.min(Math.max(factor, fitScale / scale), (fitScale * maxZoom) / scale);
  return clampView(
    zoomAt(
      view,
      px,
      py,
      limited(factorX, view.scaleX, fit.scaleX, maxZoomX),
      limited(factorY, view.scaleY, fit.scaleY, maxZoomY),
    ),
    fit,
    maxZoomX,
    maxZoomY,
  );
}

export function pan(view: View, dx: number, dy: number): View {
  return { ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy };
}

export function toWorldX(view: View, px: number): number {
  return (px - view.offsetX) / view.scaleX;
}

export function toWorldY(view: View, py: number): number {
  return (py - view.offsetY) / view.scaleY;
}

/**
 * Giữ phép biến đổi trong giới hạn: không thu nhỏ quá mức vừa khít cả cây, không phóng quá số lần cho phép
 * của từng chiều, và không kéo cây ra khỏi khung nhìn.
 */
export function clampView(view: View, fit: View, maxZoomX: number, maxZoomY = maxZoomX): View {
  const scaleX = Math.min(Math.max(view.scaleX, fit.scaleX), fit.scaleX * maxZoomX);
  const scaleY = Math.min(Math.max(view.scaleY, fit.scaleY), fit.scaleY * maxZoomY);
  // Mép của cây không được đi vào trong quá vị trí của nó lúc vừa khít: mép đầu (0) không vượt lề đầu,
  // mép cuối (1) không lùi vào trước lề cuối.
  const minOffsetX = fit.offsetX + fit.scaleX - scaleX;
  const minOffsetY = fit.offsetY + fit.scaleY - scaleY;
  return {
    scaleX,
    scaleY,
    offsetX: Math.min(fit.offsetX, Math.max(minOffsetX, view.offsetX)),
    offsetY: Math.min(fit.offsetY, Math.max(minOffsetY, view.offsetY)),
  };
}
