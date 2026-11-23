/**
 * Settings (plan phase 7): appearance (light/dark), start-with-
 * computer, and the per-printer delivery overrides — pacing (chunk
 * size and the pause between chunks) and the close delay. A field left
 * empty uses the profile's own value, shown as the placeholder.
 */
import { useEffect, useState } from "react";
import {
  isAutostart,
  listPrinters,
  loadSettings,
  saveSetting,
  setAutostart,
  type ProfileInfo,
} from "@/api";
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
  const [printers, setPrinters] = useState<ProfileInfo[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [autostart, setAutostartState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    listPrinters()
      .then(setPrinters)
      .catch((e) => setError(String(e)));
    loadSettings()
      .then((rows) => {
        setSettings(rows);
        if (rows.theme === "dark" || rows.theme === "light")
          setTheme(rows.theme);
      })
      .catch((e) => setError(String(e)));
    isAutostart()
      .then(setAutostartState)
      .catch((e) => setError(String(e)));
  }, []);

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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex flex-col gap-1">
          <h1 className="text-display font-semibold tracking-tight">
            Settings
          </h1>
          <p className="text-body text-muted-foreground">
            How the app looks and starts, and how each printer is paced.
          </p>
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-body-sm text-danger">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            The theme of the whole app. It comes back the same on the next
            start.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button
            variant={theme === "light" ? "default" : "outline"}
            onClick={() => pickTheme("light")}
          >
            Light
          </Button>
          <Button
            variant={theme === "dark" ? "default" : "outline"}
            onClick={() => pickTheme("dark")}
          >
            Dark
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Start with the computer</CardTitle>
          <CardDescription>
            Start PrintNinja when you sign in. The app then lives in the tray:
            closing the window only hides it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <span className="text-body">Start PrintNinja at sign-in</span>
          <Switch
            checked={autostart}
            onCheckedChange={toggleAutostart}
            aria-label="Start PrintNinja at sign-in"
          />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-title font-semibold">Printers</h2>
          <p className="text-body text-muted-foreground">
            Pacing and close delay, per printer. Leave a field empty to use the
            value the profile ships with.
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
                      Chunk size (bytes)
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
                      How much goes out at a time.
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`pause-${p.model}`}>
                      Pause between chunks (ms)
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
                      A slow printer needs a longer pause.
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`close-${p.model}`}>Close delay (ms)</Label>
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
                      How long the connection stays open after the last byte.
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
                      Reset to the profile's values
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
