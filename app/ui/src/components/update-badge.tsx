import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openExternalUrl, useUpdateCheck } from "@/lib/appUpdate";

/**
 * Topbar pill, shown only when a newer release exists. Opens the release
 * page so the user can update by hand — no download or install happens
 * here.
 */
export function UpdateBadge() {
  const { t } = useTranslation();
  const update = useUpdateCheck();
  if (!update.available) return null;
  const label = t("update.available", { version: update.version });
  return (
    <a
      href={update.url}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      onClick={(e) => {
        // The Tauri webview does not open external anchors on its own.
        e.preventDefault();
        void openExternalUrl(update.url);
      }}
      className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium whitespace-nowrap text-accent-foreground hover:opacity-90"
    >
      <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">v{update.version}</span>
    </a>
  );
}
