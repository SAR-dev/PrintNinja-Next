/**
 * The settings' Printers page: the printers the user has saved (from
 * the system scan, the network scan or typed by hand), and the
 * per-printer delivery overrides — pacing (chunk size and the pause
 * between chunks) and the close delay. A discovery is only a hint:
 * the scan fills the form, the user names the printer and picks the
 * profile it speaks, and only then is it saved. A field left empty
 * uses the profile's own value, shown as the placeholder.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  listSavedPrinters,
  printJob,
  type JobReport,
  removePrinter,
  savePrinter,
  scanNetworkPrinters,
  scanSystemPrinters,
  type DiscoveredPrinter,
  type ProfileInfo,
  type SavedPrinter,
  type SystemPrinter,
  type Transport,
} from "@/api";
import { JobResultBadge } from "@/components/status-badge";
import { ActionMenu } from "@/components/ui/action-menu";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TransportKind = "tcp" | "ipp" | "spooler" | "bluetooth";

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

/** One draft of the add form, all the fields the transports need. */
interface Draft {
  name: string;
  model: string;
  kind: TransportKind;
  host: string;
  port: string;
  ippAddress: string;
  ippUser: string;
  spoolerName: string;
  btAddress: string;
}

const emptyDraft = (model: string): Draft => ({
  name: "",
  model,
  kind: "spooler",
  host: "",
  port: "9100",
  ippAddress: "",
  ippUser: "",
  spoolerName: "",
  btAddress: "",
});

const transportOf = (d: Draft): Transport => {
  switch (d.kind) {
    case "tcp":
      return { kind: "tcp", host: d.host, port: Number(d.port) || 9100 };
    case "ipp":
      return { kind: "ipp", address: d.ippAddress, user: d.ippUser || null };
    case "spooler":
      return { kind: "spooler", name: d.spoolerName };
    case "bluetooth":
      return { kind: "bluetooth", address: d.btAddress };
  }
};

/** A tiny scene template that proves a saved printer works. The page
 *  version stays on the scene/PDF path, so it needs no browser. */
function testTemplate(kind: "text" | "page") {
  const page = kind === "page";
  return {
    format: "scene" as const,
    media: page
      ? { kind: "page" as const, width_mm: 210, height_mm: 297 }
      : { kind: "label" as const, width_mm: 40, height_mm: 50 },
    fields: [],
    elements: [
      {
        type: "text" as const,
        at: { x_mm: page ? 20 : 3, y_mm: page ? 20 : 5 },
        size: { w_mm: page ? 170 : 34, h_mm: page ? 20 : 6 },
        content: page ? "PrintNinja test page" : "PrintNinja test",
        style: { size_mm: page ? 8 : 3.5 },
      },
      {
        type: "line" as const,
        at: { x_mm: page ? 20 : 3, y_mm: page ? 45 : 14 },
        length_mm: page ? 170 : 34,
        thickness_mm: 0.2,
      },
    ],
  };
}

export function PrintersCard({
  printers,
  settings,
  save,
  setError,
}: {
  printers: ProfileInfo[];
  settings: Record<string, string>;
  save: (key: string, value: string) => void;
  setError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<SavedPrinter[]>([]);
  const [systemFound, setSystemFound] = useState<SystemPrinter[] | null>(null);
  const [networkFound, setNetworkFound] = useState<DiscoveredPrinter[] | null>(
    null,
  );
  const [scanning, setScanning] = useState<"system" | "network" | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** A plain-words note about the draft, when one applies. */
  const [draftHint, setDraftHint] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, JobReport>>({});

  useEffect(() => {
    listSavedPrinters()
      .then(setSaved)
      .catch((e) => setError(String(e)));
  }, [setError]);

  const scanSystem = () => {
    setScanning("system");
    setSystemFound(null);
    void scanSystemPrinters()
      .then(setSystemFound)
      .catch((e) => setError(String(e)))
      .finally(() => setScanning(null));
  };

  const scanNetwork = () => {
    setScanning("network");
    setNetworkFound(null);
    void scanNetworkPrinters(8)
      .then(setNetworkFound)
      .catch((e) => setError(String(e)))
      .finally(() => setScanning(null));
  };

  const refreshSaved = () =>
    listSavedPrinters()
      .then(setSaved)
      .catch((e) => setError(String(e)));

  const drop = (name: string) => {
    void removePrinter(name)
      .then(refreshSaved)
      .catch((e) => setError(String(e)));
  };

  /** Print a tiny job with this printer's saved profile and transport. */
  const testPrint = (
    name: string,
    model: string,
    transport: string,
    kind: "text" | "page",
  ) => {
    setTesting(name);
    void printJob(
      JSON.stringify(testTemplate(kind)),
      model,
      '[{"name":"test"}]',
      1,
      JSON.parse(transport),
    )
      .then((report) => {
        setTestResults((r) => ({ ...r, [name]: report }));
        if (
          report.result === "failed" ||
          report.result === "wrong_mode_suspected"
        )
          toast.error(report.reason ?? t("settings.test_failed"));
        else toast.success(t("settings.test_done"));
      })
      .catch((e) => {
        setError(t("settings.test_error", { error: String(e) }));
        toast.error(String(e));
      })
      .finally(() => setTesting(null));
  };

  /** A system queue fills the form: its name is the spooler's name. */
  const useSystem = (p: SystemPrinter) => {
    setDraftHint(null);
    setDraft({
      ...emptyDraft(printers[0]?.model ?? ""),
      name: p.name,
      spoolerName: p.name,
    });
  };

  /**
   * A found printer fills the form: the service type is the kind.
   * A TLS-only (_ipps) hit is prefilled with its true https://
   * address, with a note that the transport cannot use it yet.
   */
  const useNetwork = (p: DiscoveredPrinter) => {
    const ipp = p.kind === "ipp";
    const tls = ipp && p.secure;
    setDraftHint(tls ? t("settings.ipp_tls_hint") : null);
    setDraft({
      ...emptyDraft(printers[0]?.model ?? ""),
      name: p.name,
      kind: ipp ? "ipp" : "tcp",
      host: p.host,
      port: String(p.port),
      ippAddress: ipp
        ? `${tls ? "https" : "http"}://${p.host}:${p.port}${
            p.resourcePath ? "/" + p.resourcePath : ""
          }`
        : "",
    });
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (name === "" || draft.model === "") return;
    void savePrinter({
      name,
      model: draft.model,
      transport: JSON.stringify(transportOf(draft)),
    })
      .then(() => {
        setDraft(null);
        setDraftHint(null);
        return refreshSaved();
      })
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
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.saved_printers")}</CardTitle>
          <CardDescription>{t("settings.saved_printers_note")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {saved.length > 0 && (
            <div className="flex flex-col gap-2">
              {saved.map((p) => (
                <div
                  key={p.name}
                  className="flex flex-col gap-1 rounded-md border bg-background px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body">
                      {p.name}
                      <span className="text-caption text-muted-foreground">
                        {" "}
                        · {p.model}
                      </span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {testing === p.name && (
                        <span className="text-caption text-muted-foreground">
                          {t("settings.test_printing")}
                        </span>
                      )}
                      <ActionMenu
                        label={t("settings.test_print")}
                        items={[
                          {
                            label: t("settings.test_text"),
                            icon: "print",
                            onSelect: () =>
                              testPrint(p.name, p.model, p.transport, "text"),
                          },
                          {
                            label: t("settings.test_page"),
                            icon: "preview",
                            onSelect: () =>
                              testPrint(p.name, p.model, p.transport, "page"),
                          },
                        ]}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => drop(p.name)}
                      >
                        {t("settings.remove_printer")}
                      </Button>
                    </div>
                  </div>
                  {testResults[p.name] && (
                    <div className="flex items-center gap-2">
                      <JobResultBadge result={testResults[p.name].result} />
                      {testResults[p.name].reason && (
                        <span className="text-caption text-muted-foreground">
                          {testResults[p.name].reason}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={scanSystem}
              disabled={scanning !== null}
            >
              {scanning === "system"
                ? t("settings.scanning")
                : t("settings.scan_system")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={scanNetwork}
              disabled={scanning !== null}
            >
              {scanning === "network"
                ? t("settings.scanning")
                : t("settings.scan_network")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraftHint(null);
                setDraft(emptyDraft(printers[0]?.model ?? ""));
              }}
              disabled={draft !== null}
            >
              {t("settings.add_manually")}
            </Button>
          </div>

          {systemFound !== null && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <span className="text-body">
                {systemFound.length === 0
                  ? t("settings.scan_none_found")
                  : t("settings.scan_found", {
                      count: systemFound.length,
                    })}
              </span>
              {systemFound.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-body">
                    {p.name}
                    {p.port && (
                      <span className="text-caption text-muted-foreground">
                        {" "}
                        · {p.port}
                      </span>
                    )}
                    {p.status && (
                      <span className="text-caption text-warning">
                        {" "}
                        · {p.status}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => useSystem(p)}
                  >
                    {t("settings.use_printer")}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {networkFound !== null && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <span className="text-body">
                {networkFound.length === 0
                  ? t("settings.scan_none_found")
                  : t("settings.scan_found", {
                      count: networkFound.length,
                    })}
              </span>
              {networkFound.map((p) => (
                <div
                  key={`${p.host}:${p.port}`}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-body">
                    {p.name}
                    <span className="text-caption text-muted-foreground">
                      {" "}
                      · {p.host}:{p.port}
                    </span>
                    {p.secure && (
                      <span className="text-caption text-warning"> · TLS</span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => useNetwork(p)}
                  >
                    {t("settings.use_printer")}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {draft && (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              {draftHint && (
                <p className="text-caption text-warning">{draftHint}</p>
              )}
              <div className="flex flex-col gap-1">
                <Label htmlFor="sp-name">{t("settings.printer_name")}</Label>
                <Input
                  id="sp-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t("settings.printer_profile")}</Label>
                <Select
                  value={draft.model}
                  onValueChange={(v) => setDraft({ ...draft, model: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {printers.map((p) => (
                      <SelectItem key={p.model} value={p.model}>
                        {p.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t("print.transport_title")}</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(v) =>
                    setDraft({ ...draft, kind: v as TransportKind })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spooler">
                      {t("print.transport_spooler")}
                    </SelectItem>
                    <SelectItem value="tcp">
                      {t("print.transport_tcp")}
                    </SelectItem>
                    <SelectItem value="ipp">
                      {t("print.transport_ipp")}
                    </SelectItem>
                    <SelectItem value="bluetooth">
                      {t("print.transport_bluetooth")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.kind === "spooler" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="sp-queue">{t("print.queue_name")}</Label>
                  <Input
                    id="sp-queue"
                    value={draft.spoolerName}
                    onChange={(e) =>
                      setDraft({ ...draft, spoolerName: e.target.value })
                    }
                  />
                </div>
              )}
              {draft.kind === "tcp" && (
                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sp-host">{t("print.host")}</Label>
                    <Input
                      id="sp-host"
                      value={draft.host}
                      onChange={(e) =>
                        setDraft({ ...draft, host: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sp-port">{t("print.port")}</Label>
                    <Input
                      id="sp-port"
                      inputMode="numeric"
                      value={draft.port}
                      onChange={(e) =>
                        setDraft({ ...draft, port: e.target.value })
                      }
                    />
                  </div>
                </div>
              )}
              {draft.kind === "ipp" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="sp-ipp">{t("print.address")}</Label>
                  <Input
                    id="sp-ipp"
                    placeholder="http://printer:631/ipp/print"
                    value={draft.ippAddress}
                    onChange={(e) =>
                      setDraft({ ...draft, ippAddress: e.target.value })
                    }
                  />
                </div>
              )}
              {draft.kind === "bluetooth" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="sp-bt">{t("print.address")}</Label>
                  <Input
                    id="sp-bt"
                    placeholder="00:11:22:33:44:55"
                    value={draft.btAddress}
                    onChange={(e) =>
                      setDraft({ ...draft, btAddress: e.target.value })
                    }
                  />
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={saveDraft}>
                  {t("settings.save_printer")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(null);
                    setDraftHint(null);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}
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
    </div>
  );
}
