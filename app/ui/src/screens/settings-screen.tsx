/**
 * Settings (plan phase 7): appearance (light/dark), start-with-
 * computer, the LAN switch with device pairing (plan phase 8, LAN
 * increment), and the community registry's address. The screen is
 * split into pages — General, Network, Data and Registry — so each
 * concern has its own room instead of one long scroll. The printers
 * the user has saved have their own destination now (plan P3).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  appLogClear,
  appLogs,
  type AppLogEntry,
  beginPairing,
  isAutostart,
  loadSettings,
  pairedDevices,
  registryUrl,
  revokeDevice,
  saveSetting,
  setAutostart,
  type PairedDevice,
} from "@/api";
import { PageHeader } from "@/components/page-header";
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
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setLanguage } from "@/lib/i18n";

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
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
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [logError, setLogError] = useState<string | null>(null);

  const lanOn = settings["api.lan"] === "true";
  // Absent means on: the guarded fetcher is the default.
  const blockPrivateOn = settings["data.block_private_ips"] !== "false";

  useEffect(() => {
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

  const refreshLogs = () => {
    void appLogs()
      .then(setLogs)
      .catch((e) => setLogError(String(e)));
  };

  useEffect(refreshLogs, []);

  const downloadLogs = () => {
    const text = logs
      .map(
        (entry) =>
          `${new Date(entry.at_ms).toISOString()} [${entry.level}] ${entry.target}: ${entry.message}`,
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "printninja.log";
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearLogs = () => {
    void appLogClear()
      .then(() => setLogs([]))
      .catch((e) => setLogError(String(e)));
  };

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
      />

      {error && (
        <p className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-body-sm text-danger">
          {error}
        </p>
      )}

      <Tabs defaultValue="general">
        <TabsList className="flex-wrap max-md:hidden">
          <TabsTrigger value="general">{t("settings.tab_general")}</TabsTrigger>
          <TabsTrigger value="network">{t("settings.tab_network")}</TabsTrigger>
          <TabsTrigger value="data">{t("settings.tab_data")}</TabsTrigger>
          <TabsTrigger value="registry">
            {t("settings.tab_registry")}
          </TabsTrigger>
          <TabsTrigger value="diagnostics">
            {t("settings.tab_diagnostics")}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="general"
          forceMount
          className="flex-col gap-6 data-[state=active]:flex data-[state=inactive]:hidden max-md:!flex"
        >
          <h2 className="hidden text-caption font-semibold tracking-wide text-muted-foreground uppercase max-md:!inline">
            {t("settings.tab_general")}
          </h2>
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.appearance")}</CardTitle>
              <CardDescription>{t("settings.appearance_note")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Segmented
                label={t("settings.appearance")}
                value={theme}
                onChange={pickTheme}
                options={[
                  { value: "light", label: t("settings.light") },
                  { value: "dark", label: t("settings.dark") },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.language")}</CardTitle>
              <CardDescription>{t("settings.language_note")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Segmented
                label={t("settings.language")}
                value={i18n.language.startsWith("ja") ? "ja" : "en"}
                onChange={(v) => setLanguage(v)}
                options={[
                  { value: "en", label: t("settings.language_english") },
                  { value: "ja", label: t("settings.language_japanese") },
                ]}
              />
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

        <TabsContent
          value="network"
          forceMount
          className="flex-col gap-6 data-[state=active]:flex data-[state=inactive]:hidden max-md:!flex"
        >
          <h2 className="hidden text-caption font-semibold tracking-wide text-muted-foreground uppercase max-md:!inline">
            {t("settings.tab_network")}
          </h2>
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

        <TabsContent
          value="data"
          forceMount
          className="flex-col gap-6 data-[state=active]:flex data-[state=inactive]:hidden max-md:!flex"
        >
          <h2 className="hidden text-caption font-semibold tracking-wide text-muted-foreground uppercase max-md:!inline">
            {t("settings.tab_data")}
          </h2>
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

        <TabsContent
          value="registry"
          forceMount
          className="flex-col gap-6 data-[state=active]:flex data-[state=inactive]:hidden max-md:!flex"
        >
          <h2 className="hidden text-caption font-semibold tracking-wide text-muted-foreground uppercase max-md:!inline">
            {t("settings.tab_registry")}
          </h2>
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

        <TabsContent
          value="diagnostics"
          forceMount
          className="flex-col gap-6 data-[state=active]:flex data-[state=inactive]:hidden max-md:!flex"
        >
          <h2 className="hidden text-caption font-semibold tracking-wide text-muted-foreground uppercase max-md:!inline">
            {t("settings.tab_diagnostics")}
          </h2>
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.logs_title")}</CardTitle>
              <CardDescription>{t("settings.logs_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={refreshLogs}>
                  {t("settings.logs_refresh")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logs.length === 0}
                  onClick={downloadLogs}
                >
                  {t("settings.logs_download")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={logs.length === 0}
                  onClick={clearLogs}
                >
                  {t("settings.logs_clear")}
                </Button>
              </div>
              {logError && (
                <p className="text-caption text-danger">{logError}</p>
              )}
              {logs.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">
                  {t("settings.logs_empty")}
                </p>
              ) : (
                <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-caption whitespace-pre-wrap">
                  {logs
                    .map(
                      (entry) =>
                        `${new Date(entry.at_ms).toLocaleString()} [${entry.level}] ${entry.target}: ${entry.message}`,
                    )
                    .join("\n")}
                </pre>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
