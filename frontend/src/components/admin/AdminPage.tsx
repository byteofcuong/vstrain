import type { MessageKey } from "../../i18n";
import type { AdminSection } from "../../route";
import { useAuth } from "../../state/auth";
import { useT } from "../../state/store";
import { DatasetsPanel } from "./DatasetsPanel";
import { JobsPanel } from "./JobsPanel";
import { PlacesPanel } from "./PlacesPanel";

const SECTIONS: [AdminSection, MessageKey][] = [
  ["jobs", "adminJobs"],
  ["datasets", "adminDatasets"],
  ["places", "adminPlaces"],
];

/**
 * Khung của ba trang quản trị. Việc ẩn trang với người không phải admin chỉ để họ khỏi thấy một trang toàn lỗi:
 * quyền thật được kiểm ở từng endpoint của API.
 */
export function AdminPage({ section }: { section: AdminSection }) {
  const t = useT();
  const user = useAuth((state) => state.user);

  // Chưa biết ai đang dùng (đang hỏi server): chưa hiện gì, để lời báo "cần đăng nhập" không nhấp nháy.
  if (user === undefined) return <main className="page" />;
  if (user === null) {
    return (
      <main className="page">
        <h1>{t("admin")}</h1>
        <p>
          {t("adminNeedsLogin")} <a href="#/login">{t("logIn")}</a>
        </p>
      </main>
    );
  }
  if (user.role !== "admin") {
    return (
      <main className="page">
        <h1>{t("admin")}</h1>
        <p>{t("adminOnly")}</p>
      </main>
    );
  }

  return (
    <main className="page page--wide">
      <nav className="tabs" aria-label={t("admin")}>
        {SECTIONS.map(([key, label]) => (
          <a key={key} href={`#/admin/${key}`} aria-current={section === key ? "page" : undefined}>
            {t(label)}
          </a>
        ))}
      </nav>
      {section === "jobs" && <JobsPanel />}
      {section === "datasets" && <DatasetsPanel />}
      {section === "places" && <PlacesPanel />}
    </main>
  );
}
