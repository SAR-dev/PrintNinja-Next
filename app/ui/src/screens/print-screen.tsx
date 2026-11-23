/**
 * The print flow (plan phase 7): pick the printer, enter the data,
 * preview, print, and see what actually happened — every state in
 * the result vocabulary (plan §5.7) has its own words.
 */
import { useEffect, useState } from "react";
import {
  listPrinters,
  planJob,
  printJob,
  type JobReport,
  type PrepareReport,
  type ProfileInfo,
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
import type { AppTemplate } from "@/templates";

type TransportKind = "tcp" | "ipp" | "spooler" | "bluetooth";

const RESULT_WORDS: Record<
  string,
  { word: string; tone: "success" | "warning" | "danger" }
> = {
  confirmed: { word: "Confirmed", tone: "success" },
  sent_unconfirmed: { word: "Sent, not confirmed", tone: "warning" },
  partially_printed: { word: "Partially printed", tone: "warning" },
  failed: { word: "Failed", tone: "danger" },
  wrong_mode_suspected: { word: "Wrong mode suspected", tone: "danger" },
};

function ResultCard({ report }: { report: JobReport }) {
  const entry = RESULT_WORDS[report.result] ?? {
    word: report.result,
    tone: "danger",
  };
  const toneClass =
    entry.tone === "success"
      ? "bg-success-soft text-success"
      : entry.tone === "warning"
        ? "bg-warning-soft text-warning"
        : "bg-danger-soft text-danger";
  const detail =
    report.result === "partially_printed" && report.counts
      ? `${report.counts[0]} of ${report.counts[1]} made it.`
      : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Result</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div
          className={`rounded-md px-3 py-2 text-body font-medium ${toneClass}`}
        >
          {entry.word}
          {detail ? ` — ${detail}` : ""}
        </div>
        {report.reason && (
          <p className="text-body-sm text-muted-foreground">{report.reason}</p>
        )}
        {report.result === "wrong_mode_suspected" && (
          <p className="text-body-sm text-muted-foreground">
            The printer answered in a language other than its profile's — check
            the printer's mode, then try again.
          </p>
        )}
        {report.result === "sent_unconfirmed" && (
          <p className="text-body-sm text-muted-foreground">
            This printer takes jobs but cannot say whether they printed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function PrintScreen({
  starter,
  onBack,
}: {
  starter: AppTemplate;
  onBack: () => void;
}) {
  const [printers, setPrinters] = useState<ProfileInfo[]>([]);
  const [printer, setPrinter] = useState<string>("");
  const [kind, setKind] = useState<TransportKind>("tcp");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("9100");
  const [ippAddress, setIppAddress] = useState("");
  const [ippUser, setIppUser] = useState("");
  const [spoolerName, setSpoolerName] = useState("");
  const [btAddress, setBtAddress] = useState("");
  const [data, setData] = useState(starter.sample);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);
  const [copies, setCopies] = useState("1");
  const [plan, setPlan] = useState<PrepareReport | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [job, setJob] = useState<JobReport | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    listPrinters()
      .then((ps) => {
        setPrinters(ps);
        setPrinter((p) => p || ps[0]?.model || "");
      })
      .catch((e) => setPlanError(String(e)));
  }, []);

  const templateJson = JSON.stringify(starter.template);
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
      setPlan(await planJob(templateJson, printer, data, Number(copies) || 1));
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
    try {
      setJob(
        await printJob(
          templateJson,
          printer,
          data,
          Number(copies) || 1,
          transport(),
        ),
      );
    } catch (e) {
      setJob({
        result: "failed",
        counts: null,
        reason: String(e),
      });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Templates
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-display font-semibold tracking-tight">
            {starter.name}
          </h1>
          <Badge variant={starter.track === "scene" ? "default" : "secondary"}>
            {starter.track === "scene" ? "scene" : "document"}
          </Badge>
        </div>
        <p className="text-body text-muted-foreground">{starter.description}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Printer</CardTitle>
              <CardDescription>
                From the profile set — the profile is the printer.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Select value={printer} onValueChange={setPrinter}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a printer" />
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
                    <Badge variant="success">can confirm</Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Where the bytes go</CardTitle>
              <CardDescription>The transport for this job.</CardDescription>
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
                  <SelectItem value="tcp">Raw port (TCP)</SelectItem>
                  <SelectItem value="ipp">IPP</SelectItem>
                  <SelectItem value="spooler">Spooler (Windows)</SelectItem>
                  <SelectItem value="bluetooth">Bluetooth</SelectItem>
                </SelectContent>
              </Select>
              {kind === "tcp" && (
                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="host">Host</Label>
                    <Input
                      id="host"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="port">Port</Label>
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
                    <Label htmlFor="ipp-address">Address</Label>
                    <Input
                      id="ipp-address"
                      placeholder="http://printer:631/ipp/print"
                      value={ippAddress}
                      onChange={(e) => setIppAddress(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="ipp-user">User (optional)</Label>
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
                  <Label htmlFor="spooler-name">Printer queue name</Label>
                  <Input
                    id="spooler-name"
                    value={spoolerName}
                    onChange={(e) => setSpoolerName(e.target.value)}
                  />
                </div>
              )}
              {kind === "bluetooth" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bt-address">Address</Label>
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
              <CardTitle>Data</CardTitle>
              <CardDescription>
                JSON (one object per record) or CSV (a header row and its rows);{" "}
                {"{{name}}"} in the template is filled from each record's
                fields.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Textarea
                rows={5}
                spellCheck={false}
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
                  onClick={() => fileInput?.click()}
                >
                  Load from file…
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
                {loaded && (
                  <span className="text-caption text-muted-foreground">
                    loaded {loaded}
                  </span>
                )}
              </div>
              <div className="flex w-24 flex-col gap-1">
                <Label htmlFor="copies">Copies</Label>
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
              <CardTitle>Preview</CardTitle>
              <CardDescription>
                Every page of the prepared job — the same path as the print,
                nothing touches the wire.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Button onClick={preview} disabled={planning || !printer}>
                  {planning ? "Preparing…" : "Preview"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={print}
                  disabled={printing || !printer}
                >
                  {printing ? "Printing…" : "Print"}
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
                      {plan.records} record{plan.records === 1 ? "" : "s"} ·{" "}
                      {plan.pages} page{plan.pages === 1 ? "" : "s"} ·{" "}
                      {plan.units} unit{plan.units === 1 ? "" : "s"} ·{" "}
                      {plan.bytes} B
                    </span>
                  </div>
                  {plan.fallback && (
                    <div className="rounded-md bg-warning-soft px-3 py-2 text-body-sm text-warning">
                      Fell back from the track's preferred path: {plan.fallback}
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
