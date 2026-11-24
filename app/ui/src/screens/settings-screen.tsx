/**
 * Settings (plan phase 7): appearance (light/dark), start-with-
 * computer, the LAN switch with device pairing (plan phase 8, LAN
 * increment), and the per-printer delivery overrides — pacing (chunk
 * size and the pause between chunks) and the close delay. A field left
 * empty uses the profile's own value, shown as the placeholder.
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
import { setLanguage } from "@/lib/i18n";

/** The user's delivery override for one printer, as it is saved. */
interface DeliveryOverride {
  chunkBytes?: number;
  pauseMs?: number;
  closeDelayMs?: number;
}

const deliveryKey = (model: string) => `delivery.${model}`;

function readOverride(
  settings: Record<string, string>,
  model: string,
): DeliveryOverride {
  const raw = settings[deliveryKey(model)];
  if (!raw) return {};
  try {
    return JSON.parse(raw) as DeliveryOverride;
  } catch {
    return {};
  }
}

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

  const overrideFor = (p: ProfileInfo) => readOverride(settings, p.model);

  const saveField = (
    p: ProfileInfo,
    field: keyof DeliveryOverride,
    text: string,
    fallback: number,
  ) => {
    const o = overrideFor(p);
    if (text.trim() === "" || Number(text) === fallback) {
      const { [field]: _removed, ...rest } = o;
      save(deliveryKey(p.model), JSON.stringify(rest));
    } else {
      save(
        deliveryKey(p.model),
        JSON.stringify({ ...o, [field]: Number(text) }),
      );
    }
  };

  const resetPrinter = (p: ProfileInfo) =>
    save(deliveryKey(p.model), JSON.stringify({}));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
      >
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t("common.back")}
        </Button>
      </PageHeader>

      {error && (
        <p className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-body-sm text-danger">
          {error}
        </p>
      )}

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
          <span className="text-body">{t("settings.autostart_switch")}</span>
          <Switch
            checked={autostart}
            onCheckedChange={toggleAutostart}
            aria-label={t("settings.autostart_switch")}
          />
        </CardContent>
      </Card>

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
              onCheckedChange={(on) => save("api.lan", on ? "true" : "false")}
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

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.data")}</CardTitle>
          <CardDescription>{t("settings.data_note")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-body">{t("settings.block_private_ips")}</span>
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

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-title font-semibold">{t("settings.printers")}</h2>
          <p className="text-body text-muted-foreground">
            {t("settings.printers_note")}
          </p>
        </div>
        {printers.map((p) => {
          const o = overrideFor(p);
          const hasOverride = Object.keys(o).length > 0;
          return (
            <Card key={p.model}>
              <CardHeader>
                <CardTitle>{p.model}</CardTitle>
                <CardDescription>
                  {p.language} · {p.media.join(", ")}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`chunk-${p.model}`}>
                      {t("settings.chunk_size")}
                    </Label>
                    <Input
                      id={`chunk-${p.model}`}
                      inputMode="numeric"
                      placeholder={String(p.delivery.chunk_bytes)}
                      defaultValue={o.chunkBytes ?? ""}
                      onBlur={(e) =>
                        saveField(
                          p,
                          "chunkBytes",
                          e.target.value,
                          p.delivery.chunk_bytes,
                        )
                      }
                    />
                    <span className="text-caption text-muted-foreground">
                      {t("settings.chunk_size_note")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`pause-${p.model}`}>
                      {t("settings.pause")}
                    </Label>
                    <Input
                      id={`pause-${p.model}`}
                      inputMode="numeric"
                      placeholder={String(p.delivery.pause_ms)}
                      defaultValue={o.pauseMs ?? ""}
                      onBlur={(e) =>
                        saveField(
                          p,
                          "pauseMs",
                          e.target.value,
                          p.delivery.pause_ms,
                        )
                      }
                    />
                    <span className="text-caption text-muted-foreground">
                      {t("settings.pause_note")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`close-${p.model}`}>
                      {t("settings.close_delay")}
                    </Label>
                    <Input
                      id={`close-${p.model}`}
                      inputMode="numeric"
                      placeholder={String(p.delivery.close_delay_ms)}
                      defaultValue={o.closeDelayMs ?? ""}
                      onBlur={(e) =>
                        saveField(
                          p,
                          "closeDelayMs",
                          e.target.value,
                          p.delivery.close_delay_ms,
                        )
                      }
                    />
                    <span className="text-caption text-muted-foreground">
                      {t("settings.close_delay_note")}
                    </span>
                  </div>
                </div>
                {hasOverride && (
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resetPrinter(p)}
                    >
                      {t("settings.reset_profile_values")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </main>
  );
}
