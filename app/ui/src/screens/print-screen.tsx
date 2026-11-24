/**
 * The print flow (plan phase 7): pick the printer, enter the data,
 * preview, print, and see what actually happened — every state in
 * the result vocabulary (plan §5.7) has its own words.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchData,
  listPrinters,
  listSavedPrinters,
  planJob,
  printJob,
  type JobReport,
  type PrepareReport,
  type ProfileInfo,
  type SavedPrinter,
  type Transport,
} from "@/api";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { JobPreview } from "@/components/job-preview";
import { PageHeader } from "@/components/page-header";
import { withTemplateStyles } from "@/lib/tailwind";
import { resultTone, toneClass } from "@/result-words";
import type { AppTemplate, RecentJob } from "@/templates";

type TransportKind = "tcp" | "ipp" | "spooler" | "bluetooth";

function ResultCard({ report }: { report: JobReport }) {
  const { t, i18n } = useTranslation();
  const word = i18n.exists(`result.${report.result}`)
    ? t(`result.${report.result}`)
    : report.result;
  const detail =
    report.result === "partially_printed" && report.counts
      ? t("result.made_it", {
          printed: report.counts[0],
          total: report.counts[1],
        })
      : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("result.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div
          className={`rounded-md px-3 py-2 text-body font-medium ${toneClass(resultTone(report.result))}`}
        >
          {word}
          {detail ? ` — ${detail}` : ""}
        </div>
        {report.reason && (
          <p className="text-body-sm text-muted-foreground">{report.reason}</p>
        )}
        {report.result === "wrong_mode_suspected" && (
          <p className="text-body-sm text-muted-foreground">
            {t("result.wrong_mode_hint")}
          </p>
        )}
        {report.result === "sent_unconfirmed" && (
          <p className="text-body-sm text-muted-foreground">
            {t("result.sent_unconfirmed_hint")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function PrintScreen({
  starter,
  prefill,
  onBack,
  onJob,
}: {
  starter: AppTemplate;
  /** A deep link's starting values (plan phase 8): the printer,
   * copies and data URL the link carried, if it carried them. */
  prefill?: { printer?: string; copies?: number; dataUrl?: string };
  onBack: () => void;
  /** The job, with its result — the recent-jobs list remembers it. */
  onJob: (job: RecentJob) => void;
}) {
  const { t } = useTranslation();
  const [printers, setPrinters] = useState<ProfileInfo[]>([]);
  const [printer, setPrinter] = useState<string>("");
  const [saved, setSaved] = useState<SavedPrinter[]>([]);
  const [savedName, setSavedName] = useState("");
  const [kind, setKind] = useState<TransportKind>("tcp");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("9100");
  const [ippAddress, setIppAddress] = useState("");
  const [ippUser, setIppUser] = useState("");
  const [spoolerName, setSpoolerName] = useState("");
  const [btAddress, setBtAddress] = useState("");
  const [data, setData] = useState(starter.sample);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState(prefill?.dataUrl ?? "");
  const [dataMethod, setDataMethod] = useState("GET");
  const [fetchWarn, setFetchWarn] = useState<string | null>(null);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);
  const [copies, setCopies] = useState(
    prefill?.copies ? String(prefill.copies) : "1",
  );
  const [plan, setPlan] = useState<PrepareReport | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [job, setJob] = useState<JobReport | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    listPrinters()
      .then((ps) => {
        setPrinters(ps);
        // A deep link's printer, if it named one this profile set has.
        setPrinter(
          (p) =>
            p ||
            ps.find((x) => x.model === prefill?.printer)?.model ||
            ps[0]?.model ||
            "",
        );
      })
      .catch((e) => setPlanError(String(e)));
  }, []);

  // The printers the user saved: picking one fills the profile and the
  // transport below with the row the settings screen stored. A failure
  // only costs the shortcut — printing by hand still works.
  useEffect(() => {
    listSavedPrinters()
      .then(setSaved)
      .catch(() => undefined);
  }, []);

  const pickSaved = (name: string) => {
    setSavedName(name);
    const sp = saved.find((s) => s.name === name);
    if (!sp) return;
    setPrinter(sp.model);
    let tr: {
      kind: TransportKind;
      host?: string;
      port?: number;
      address?: string;
      user?: string | null;
      name?: string;
    };
    try {
      tr = JSON.parse(sp.transport);
    } catch {
      return;
    }
    switch (tr.kind) {
      case "tcp":
        setKind("tcp");
        if (tr.host) setHost(tr.host);
        if (tr.port) setPort(String(tr.port));
        break;
      case "ipp":
        setKind("ipp");
        if (tr.address) setIppAddress(tr.address);
        setIppUser(tr.user ?? "");
        break;
      case "spooler":
        setKind("spooler");
        if (tr.name) setSpoolerName(tr.name);
        break;
      case "bluetooth":
        setKind("bluetooth");
        if (tr.address) setBtAddress(tr.address);
        break;
    }
  };

  /**
   * The template JSON the pipeline gets. A document template carries its
   * styles at this moment — the embedded fonts become `@font-face` data
   * URIs and the Tailwind classes are compiled, both injected in memory
   * (see lib/tailwind) before the HTML leaves the UI, so the preview and
   * the print render what the editor shows.
   */
  const preparedTemplateJson = async () => {
    const tpl = starter.template;
    if (starter.track === "document" && tpl.html) {
      return JSON.stringify({
        ...tpl,
        html: await withTemplateStyles(tpl.html, tpl.fonts),
      });
    }
    return JSON.stringify(tpl);
  };
  const chosen = printers.find((p) => p.model === printer);

  const transport = (): Transport => {
    switch (kind) {
      case "tcp":
        return { kind: "tcp", host, port: Number(port) || 9100 };
      case "ipp":
        return { kind: "ipp", address: ippAddress, user: ippUser || null };
      case "spooler":
        return { kind: "spooler", name: spoolerName };
      case "bluetooth":
        return { kind: "bluetooth", address: btAddress };
    }
  };

  /** The data URL, if typed: the job's data comes from the fetch. */
  const urlActive = dataUrl.trim() !== "";

  /** The data URL's body text — JSON or CSV, the pipeline's call. */
  const fetchBody = () => fetchData(dataUrl.trim(), dataMethod);

  /** A local data file, as its text — JSON or CSV, the parser's call. */
  const loadFile = async (f: File) => {
    try {
      setData(await f.text());
      setLoaded(f.name);
      setPlanError(null);
    } catch (e) {
      setPlanError(String(e));
    }
  };

  const preview = async () => {
    setPlanning(true);
    setPlanError(null);
    setJob(null);
    try {
      let body = data;
      if (urlActive) {
        try {
          body = await fetchBody();
          setFetchWarn(null);
        } catch (e) {
          // The preview falls back to the typed data; the print
          // re-fetches the URL, the way the old app printed from a
          // URL its preview could not reach.
          setFetchWarn(t("print.url_preview_failed", { error: String(e) }));
        }
      }
      setPlan(
        await planJob(
          await preparedTemplateJson(),
          printer,
          body,
          Number(copies) || 1,
        ),
      );
    } catch (e) {
      setPlan(null);
      setPlanError(String(e));
    } finally {
      setPlanning(false);
    }
  };

  const print = async () => {
    setPrinting(true);
    setJob(null);
    const copiesN = Number(copies) || 1;
    // The fetch is fresh — the print always prints what the URL has
    // now, and the recent job freezes that fetched text.
    let body = data;
    if (urlActive) {
      try {
        body = await fetchBody();
        setFetchWarn(null);
      } catch (e) {
        setPrinting(false);
        setJob({
          result: "failed",
          counts: null,
          reason: t("print.url_fetch_failed", { error: String(e) }),
        });
        return;
      }
    }
    let report: JobReport;
    try {
      report = await printJob(
        await preparedTemplateJson(),
        printer,
        body,
        copiesN,
        transport(),
      );
    } catch (e) {
      report = {
        result: "failed",
        counts: null,
        reason: t("print.job_failed", { error: String(e) }),
      };
    }
    setJob(report);
    onJob({
      id: `job-${Date.now().toString(36)}`,
      templateName: starter.name,
      template: starter.template,
      track: starter.track,
      profile: printer,
      data: body,
      copies: copiesN,
      transport: transport(),
      result: report,
      at: Date.now(),
    });
    setPrinting(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={starter.name}
        description={starter.description}
        back={{ onClick: onBack, label: t("common.back") }}
      >
        <Badge variant={starter.track === "scene" ? "default" : "secondary"}>
          {starter.track === "scene"
            ? t("app.track_scene")
            : t("app.track_document")}
        </Badge>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("print.printer")}</CardTitle>
              <CardDescription>{t("print.printer_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {saved.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Label>{t("print.saved_printers")}</Label>
                  <Select value={savedName} onValueChange={pickSaved}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("print.pick_saved")} />
                    </SelectTrigger>
                    <SelectContent>
                      {saved.map((s) => (
                        <SelectItem key={s.name} value={s.name}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Select value={printer} onValueChange={setPrinter}>
                <SelectTrigger>
                  <SelectValue placeholder={t("print.pick_printer")} />
                </SelectTrigger>
                <SelectContent>
                  {printers.map((p) => (
                    <SelectItem key={p.model} value={p.model}>
                      {p.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {chosen && (
                <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
                  <span>{chosen.language}</span>
                  <span>·</span>
                  <span>{chosen.media.join(", ")}</span>
                  {chosen.can_confirm && (
                    <Badge variant="success">{t("print.can_confirm")}</Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("print.transport_title")}</CardTitle>
              <CardDescription>{t("print.transport_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as TransportKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tcp">
                    {t("print.transport_tcp")}
                  </SelectItem>
                  <SelectItem value="ipp">
                    {t("print.transport_ipp")}
                  </SelectItem>
                  <SelectItem value="spooler">
                    {t("print.transport_spooler")}
                  </SelectItem>
                  <SelectItem value="bluetooth">
                    {t("print.transport_bluetooth")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {kind === "tcp" && (
                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="host">{t("print.host")}</Label>
                    <Input
                      id="host"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="port">{t("print.port")}</Label>
                    <Input
                      id="port"
                      inputMode="numeric"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                    />
                  </div>
                </div>
              )}
              {kind === "ipp" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="ipp-address">{t("print.address")}</Label>
                    <Input
                      id="ipp-address"
                      placeholder="http://printer:631/ipp/print"
                      value={ippAddress}
                      onChange={(e) => setIppAddress(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="ipp-user">{t("print.user_optional")}</Label>
                    <Input
                      id="ipp-user"
                      value={ippUser}
                      onChange={(e) => setIppUser(e.target.value)}
                    />
                  </div>
                </div>
              )}
              {kind === "spooler" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="spooler-name">{t("print.queue_name")}</Label>
                  <Input
                    id="spooler-name"
                    value={spoolerName}
                    onChange={(e) => setSpoolerName(e.target.value)}
                  />
                </div>
              )}
              {kind === "bluetooth" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bt-address">{t("print.address")}</Label>
                  <Input
                    id="bt-address"
                    placeholder="00:11:22:33:44:55"
                    value={btAddress}
                    onChange={(e) => setBtAddress(e.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("print.data")}</CardTitle>
              <CardDescription>
                {t("print.data_note", { field: "{{name}}" })}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="data-url">{t("print.data_url")}</Label>
                  <Input
                    id="data-url"
                    placeholder="https://…"
                    value={dataUrl}
                    onChange={(e) => {
                      setDataUrl(e.target.value);
                      setFetchWarn(null);
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>{t("print.data_method")}</Label>
                  <Select value={dataMethod} onValueChange={setDataMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-caption text-muted-foreground">
                {t("print.data_url_note")}
              </p>
              <Textarea
                rows={5}
                spellCheck={false}
                disabled={urlActive}
                value={data}
                onChange={(e) => {
                  setData(e.target.value);
                  setLoaded(null);
                }}
              />
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={urlActive}
                  onClick={() => fileInput?.click()}
                >
                  {t("print.load_from_file")}
                </Button>
                <input
                  ref={setFileInput}
                  type="file"
                  accept=".json,.csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadFile(f);
                    e.target.value = "";
                  }}
                />
                {urlActive ? (
                  <span className="text-caption text-muted-foreground">
                    {t("print.data_url_active")}
                  </span>
                ) : (
                  loaded && (
                    <span className="text-caption text-muted-foreground">
                      {t("print.loaded", { file: loaded })}
                    </span>
                  )
                )}
              </div>
              {fetchWarn && (
                <div className="rounded-md bg-warning-soft px-3 py-2 text-body-sm text-warning">
                  {fetchWarn}
                </div>
              )}
              <div className="flex w-24 flex-col gap-1">
                <Label htmlFor="copies">{t("print.copies")}</Label>
                <Input
                  id="copies"
                  inputMode="numeric"
                  value={copies}
                  onChange={(e) => setCopies(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("print.preview")}</CardTitle>
              <CardDescription>{t("print.preview_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Button onClick={preview} disabled={planning || !printer}>
                  {planning ? t("print.preparing") : t("print.preview")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={print}
                  disabled={printing || !printer}
                >
                  {printing ? t("print.printing") : t("app.print")}
                </Button>
              </div>
              {planError && (
                <div className="rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger">
                  {planError}
                </div>
              )}
              {plan && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
                    <Badge variant="outline">{plan.path}</Badge>
                    <span>
                      {t("print.records", { count: plan.records })} ·{" "}
                      {t("print.pages", { count: plan.pages })} ·{" "}
                      {t("print.units", { count: plan.units })} · {plan.bytes} B
                    </span>
                  </div>
                  {plan.fallback && (
                    <div className="rounded-md bg-warning-soft px-3 py-2 text-body-sm text-warning">
                      {t("print.fallback", { path: plan.fallback })}
                    </div>
                  )}
                  {plan.preview && plan.preview.length > 0 && (
                    <JobPreview previews={plan.preview} />
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {job && <ResultCard report={job} />}
        </div>
      </div>
    </div>
  );
}
