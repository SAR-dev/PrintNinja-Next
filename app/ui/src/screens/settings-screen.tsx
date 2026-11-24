/**
 * Settings (plan phase 7): appearance (light/dark), start-with-
 * computer, the LAN switch with device pairing (plan phase 8, LAN
 * increment), the printers the user has saved and their per-printer
 * delivery overrides, and the community registry's address. The
 * screen is split into pages — General, Printers, Network, Data and
 * Registry — so each concern has its own room instead of one long
 * scroll. A delivery field left empty uses the profile's own value,
 * shown as the placeholder.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  beginPairing,
  isAutostart,
  listPrinters,
  loadSettings,
  pairedDevices,
  registryUrl,
  revokeDevice,
  saveSetting,
  setAutostart,
  type PairedDevice,
  type ProfileInfo,
} from "@/api";
import { PageHeader } from "@/components/page-header";
import { PrintersCard } from "@/components/printers-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setLanguage } from "@/lib/i18n";

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const [printers, setPrinters] = useState<ProfileInfo[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [autostart, setAutostartState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairLeft, setPairLeft] = useState(0);
  /** The registry's server address, the text in the field. */
  const [registryUrlText, setRegistryUrlText] = useState("");
  /** The address the app resolves to now, shown as the placeholder. */
  const [registryDefault, setRegistryDefault] = useState("");

  const lanOn = settings["api.lan"] === "true";
  // Absent means on: the guarded fetcher is the default.
  const blockPrivateOn = settings["data.block_private_ips"] !== "false";

  useEffect(() => {
    listPrinters()
      .then(setPrinters)
      .catch((e) => setError(String(e)));
    loadSettings()
      .then((rows) => {
        setSettings(rows);
        if (rows.theme === "dark" || rows.theme === "light")
          setTheme(rows.theme);
        setRegistryUrlText(rows["registry.url"] ?? "");
      })
      .catch((e) => setError(String(e)));
    registryUrl()
      .then(setRegistryDefault)
      .catch((e) => setError(String(e)));
    isAutostart()
      .then(setAutostartState)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!lanOn) return;
    pairedDevices()
      .then(setDevices)
      .catch((e) => setError(String(e)));
  }, [lanOn]);

  // The one-time code's clock: it runs while the code is on screen and
  // takes the code down when it is up.
  useEffect(() => {
    if (pairCode === null) return;
    const timer = setInterval(() => {
      setPairLeft((n) => {
        if (n <= 1) {
          clearInterval(timer);
          setPairCode(null);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pairCode]);

  const save = (key: string, value: string) => {
    void saveSetting(key, value)
      .then(() => setSettings((s) => ({ ...s, [key]: value })))
      .catch((e) => setError(String(e)));
  };

  const pickTheme = (next: "light" | "dark") => {
    setTheme(next);
    document.documentElement.dataset.theme = next === "dark" ? "dark" : "";
    save("theme", next);
  };

  const toggleAutostart = (on: boolean) => {
    setAutostartState(on);
    void setAutostart(on).catch((e) => {
      setAutostartState(!on);
      setError(String(e));
    });
  };

  const refreshDevices = () =>
    pairedDevices()
      .then(setDevices)
      .catch((e) => setError(String(e)));

  const pair = () => {
    void beginPairing()
      .then((code) => {
        setPairCode(code);
        setPairLeft(90);
      })
      .catch((e) => setError(String(e)));
  };

  const revoke = (id: string) => {
    void revokeDevice(id)
      .then(refreshDevices)
      .catch((e) => setError(String(e)));
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
        back={{ onClick: onBack, label: t("common.back") }}
      />

      {error && (
        <p className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-body-sm text-danger">
          {error}
        </p>
      )}

      <Tabs defaultValue="general">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general">{t("settings.tab_general")}</TabsTrigger>
          <TabsTrigger value="printers">
            {t("settings.tab_printers")}
          </TabsTrigger>
          <TabsTrigger value="network">{t("settings.tab_network")}</TabsTrigger>
          <TabsTrigger value="data">{t("settings.tab_data")}</TabsTrigger>
          <TabsTrigger value="registry">
            {t("settings.tab_registry")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.appearance")}</CardTitle>
              <CardDescription>{t("settings.appearance_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                onClick={() => pickTheme("light")}
              >
                {t("settings.light")}
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                onClick={() => pickTheme("dark")}
              >
                {t("settings.dark")}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.language")}</CardTitle>
              <CardDescription>{t("settings.language_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                variant={i18n.language === "en" ? "default" : "outline"}
                onClick={() => setLanguage("en")}
              >
                {t("settings.language_english")}
              </Button>
              <Button
                variant={i18n.language === "ja" ? "default" : "outline"}
                onClick={() => setLanguage("ja")}
              >
                {t("settings.language_japanese")}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.autostart")}</CardTitle>
              <CardDescription>{t("settings.autostart_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <span className="text-body">
                {t("settings.autostart_switch")}
              </span>
              <Switch
                checked={autostart}
                onCheckedChange={toggleAutostart}
                aria-label={t("settings.autostart_switch")}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="printers" className="flex flex-col gap-6">
          <PrintersCard
            printers={printers}
            settings={settings}
            save={save}
            setError={setError}
          />
        </TabsContent>

        <TabsContent value="network" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.network")}</CardTitle>
              <CardDescription>{t("settings.network_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-body">{t("settings.lan_switch")}</span>
                <Switch
                  checked={lanOn}
                  onCheckedChange={(on) =>
                    save("api.lan", on ? "true" : "false")
                  }
                  aria-label={t("settings.lan_switch")}
                />
              </div>
              {lanOn && (
                <div className="flex flex-col gap-3">
                  {pairCode !== null ? (
                    <div className="flex flex-col gap-1 rounded-lg border p-3">
                      <span className="text-body">
                        {t("settings.pair_code_note")}
                      </span>
                      <span className="font-mono text-title tracking-[0.3em]">
                        {pairCode.replace(/(.{4})/g, "$1 ").trim()}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {t("settings.pair_seconds_left", { seconds: pairLeft })}
                      </span>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={pair}>
                      {t("settings.pair_a_device")}
                    </Button>
                  )}
                  {devices.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {devices.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between gap-4"
                        >
                          <span className="text-body">
                            {d.name}
                            <span className="text-caption text-muted-foreground">
                              {" "}
                              · {d.platform} ·{" "}
                              {new Date(d.pairedAt).toLocaleDateString()}
                            </span>
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revoke(d.id)}
                          >
                            {t("settings.revoke")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.data")}</CardTitle>
              <CardDescription>{t("settings.data_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-body">
                  {t("settings.block_private_ips")}
                </span>
                <Switch
                  checked={blockPrivateOn}
                  onCheckedChange={(on) =>
                    save("data.block_private_ips", on ? "true" : "false")
                  }
                  aria-label={t("settings.block_private_ips")}
                />
              </div>
              <span className="text-caption text-muted-foreground">
                {t("settings.block_private_ips_note")}
              </span>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="registry" className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.registry")}</CardTitle>
              <CardDescription>
                {t("settings.registry_note", {
                  default: registryDefault || "http://127.0.0.1:8787",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Label htmlFor="registry-url">{t("settings.registry_url")}</Label>
              <Input
                id="registry-url"
                value={registryUrlText}
                onChange={(e) => setRegistryUrlText(e.target.value)}
                onBlur={() => save("registry.url", registryUrlText.trim())}
                placeholder={registryDefault}
              />
              <span className="text-caption text-muted-foreground">
                {t("settings.registry_url_note")}
              </span>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
