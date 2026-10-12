import { useEffect, useState } from "react";

import type { MapData } from "./types";
import mapUrl from "./vn-map.json?url";

export type MapState = { status: "idle" | "loading" | "error"; data: null } | { status: "ready"; data: MapData };

/** File hình học được tải một lần cho cả phiên làm việc; mọi nơi cần nó dùng chung một lần tải. */
let pending: Promise<MapData> | null = null;

function fetchMap(): Promise<MapData> {
  pending ??= fetch(mapUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<MapData>;
    })
    .catch((error: unknown) => {
      // Lần tải hỏng không được giữ lại: lần gọi sau thử lại từ đầu.
      pending = null;
      throw error;
    });
  return pending;
}

/**
 * Hình học của bản đồ, chỉ tải khi `wanted` là true (bảng bản đồ đang mở). File nằm ngoài bundle chính: trang
 * danh sách và dataset không có cột địa bàn không phải tải nó. Đã tải rồi thì giữ lại, kể cả khi `wanted` về
 * false: bộ lọc theo địa bàn vẫn cần nó sau khi bảng bản đồ bị ẩn.
 */
export function useMapData(wanted: boolean): MapState & { retry(): void } {
  const [state, setState] = useState<MapState>({ status: "idle", data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!wanted) return;
    let current = true;
    setState((known) => (known.status === "ready" ? known : { status: "loading", data: null }));
    fetchMap().then(
      (data) => current && setState({ status: "ready", data }),
      (error: unknown) => {
        console.error(error);
        if (current) setState({ status: "error", data: null });
      },
    );
    return () => {
      current = false;
    };
  }, [wanted, attempt]);

  return { ...state, retry: () => setAttempt((count) => count + 1) };
}
