import { useEffect, useState } from "react";

import { listProvinces, type AdminUnit } from "../api";

/**
 * Danh mục tỉnh, thành (cả hai bộ, khoảng 100 dòng), tải một lần cho cả phiên làm việc: form nộp mẫu, trang mẫu đã
 * nộp và bảng chi tiết của một mẫu tạm cùng dùng.
 */
let cached: Promise<AdminUnit[]> | null = null;

function load(): Promise<AdminUnit[]> {
  cached ??= listProvinces().catch((error: unknown) => {
    // Lần tải hỏng không được giữ lại: lần sau thử lại.
    cached = null;
    throw error;
  });
  return cached;
}

export type Provinces =
  | { state: "loading"; units: AdminUnit[] }
  | { state: "ready"; units: AdminUnit[] }
  | { state: "error"; units: AdminUnit[] };

export function useProvinces(): Provinces & { retry(): void } {
  const [provinces, setProvinces] = useState<Provinces>({ state: "loading", units: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setProvinces({ state: "loading", units: [] });
    load()
      .then((units) => current && setProvinces({ state: "ready", units }))
      .catch((error: unknown) => {
        console.error(error);
        if (current) setProvinces({ state: "error", units: [] });
      });
    return () => {
      current = false;
    };
  }, [attempt]);

  return { ...provinces, retry: () => setAttempt((count) => count + 1) };
}

/** Tên của một đơn vị theo mã, hoặc chính mã khi danh mục chưa tải hay không có mã đó. */
export function unitName(units: readonly AdminUnit[], code: string | null, lang: "vi" | "en"): string | null {
  if (code === null) return null;
  const unit = units.find((one) => one.code === code);
  return unit ? (lang === "vi" ? unit.nameVi : unit.nameEn) : code;
}
