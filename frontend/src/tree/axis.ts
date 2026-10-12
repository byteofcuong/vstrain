import { isoDate, niceTicks } from "./dates";
import type { Positions } from "./layout";
import type { Padding, View } from "./view";

/** Đường dóng của trục: đường dọc (bố cục chữ nhật) hoặc vòng tròn đồng tâm (bố cục toả tròn), kèm nhãn. */
export type Guides =
  { kind: "lines"; positions: number[]; labels: string[] } | { kind: "rings"; radii: number[]; labels: string[] };

function label(value: number, step: number, axis: Positions["axis"]): string {
  if (axis === "time") {
    // Mốc cách nhau từ một năm trở lên thì chỉ cần năm; phóng to hơn nữa thì ghi cả ngày.
    return step >= 1 ? String(Math.round(value)) : isoDate(value);
  }
  return String(Number(value.toPrecision(2)));
}

/** Các mốc của trục cho khung nhìn hiện tại. Khoảng cách giữa hai mốc khoảng `spacing` pixel. */
export function computeGuides(positions: Positions, view: View, width: number, padding: Padding, spacing = 96): Guides {
  const { min, max, axis } = positions;
  const span = max - min || 1;

  if (positions.layout === "radial") {
    const radius = 0.5 * view.scaleX;
    const ticks = niceTicks(min, max, Math.max(2, Math.floor(radius / 56)));
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : span;
    return {
      kind: "rings",
      radii: ticks.map((tick) => ((tick - min) / span) * radius),
      labels: ticks.map((tick) => label(tick, step, axis)),
    };
  }

  const left = padding.left;
  const right = width - padding.right;
  const from = Math.max(min, min + ((left - view.offsetX) / view.scaleX) * span);
  const to = Math.min(max, min + ((right - view.offsetX) / view.scaleX) * span);
  const ticks = niceTicks(from, to, Math.max(2, Math.floor((right - left) / spacing)));
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : span;
  return {
    kind: "lines",
    positions: ticks.map((tick) => view.offsetX + ((tick - min) / span) * view.scaleX),
    labels: ticks.map((tick) => label(tick, step, axis)),
  };
}
