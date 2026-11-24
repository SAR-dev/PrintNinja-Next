/**
 * The Printers destination (plan P3): the printers the user added
 * from a scan or by hand, and each one's delivery overrides. Moved
 * out of the settings screen's Printers tab.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listPrinters,
  loadSettings,
  saveSetting,
  type ProfileInfo,
} from "@/api";
import { PageHeader } from "@/components/page-header";
import { PrintersCard } from "@/components/printers-card";

export function PrintersScreen() {
  const { t } = useTranslation();
  const [printers, setPrinters] = useState<ProfileInfo[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPrinters()
      .then(setPrinters)
      .catch((e) => setError(String(e)));
    loadSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, []);

  const save = (key: string, value: string) => {
    void saveSetting(key, value)
      .then(() => setSettings((s) => ({ ...s, [key]: value })))
      .catch((e) => setError(String(e)));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("nav.printers")}
        description={t("settings.saved_printers_note")}
      />

      {error && (
        <p className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-body-sm text-danger">
          {error}
        </p>
      )}

      <PrintersCard
        printers={printers}
        settings={settings}
        save={save}
        setError={setError}
      />
    </div>
  );
}
