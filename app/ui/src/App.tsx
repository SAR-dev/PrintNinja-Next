import { useEffect, useState } from "react";
import {
  loadRecentJobs,
  loadSettings,
  loadTemplates,
  printJob,
  rememberJob,
  saveTemplate,
  type JobReport,
  type StoredJob,
  type StoredTemplate,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { blankTemplate } from "@/scene/editor-model";
import { DeepLinkListener } from "@/deeplink";
import { DocumentEditorScreen } from "@/screens/document-editor-screen";
import { EditorScreen } from "@/screens/editor-screen";
import { PrintScreen } from "@/screens/print-screen";
import { SettingsScreen } from "@/screens/settings-screen";
import { RESULT_WORDS, toneClass } from "@/result-words";
import {
  blankDocument,
  mergeTemplates,
  starters,
  type AppTemplate,
  type RecentJob,
} from "@/templates";

/** How many jobs the recent list remembers (the store keeps the same). */
const RECENT_LIMIT = 10;

/** The stored row for a template: the template as JSON text. */
function toStoredTemplate(t: AppTemplate): StoredTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    track: t.track,
    template: JSON.stringify(t.template),
    sample: t.sample,
  };
}

/** The stored row for a job: template, transport and result as JSON text. */
function toStoredJob(j: RecentJob): StoredJob {
  return {
    id: j.id,
    templateName: j.templateName,
    template: JSON.stringify(j.template),
    track: j.track,
    profile: j.profile,
    data: j.data,
    copies: j.copies,
    transport: JSON.stringify(j.transport),
    result: JSON.stringify(j.result),
    at: j.at,
  };
}

function fromStoredJob(row: StoredJob): RecentJob {
  return {
    id: row.id,
    templateName: row.templateName,
    template: JSON.parse(row.template) as RecentJob["template"],
    track: row.track as RecentJob["track"],
    profile: row.profile,
    data: row.data,
    copies: row.copies,
    transport: JSON.parse(row.transport) as RecentJob["transport"],
    result: JSON.parse(row.result) as RecentJob["result"],
    at: row.at,
  };
}

function jobTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today ${hm}` : `${d.toLocaleDateString()} ${hm}`;
}

/** Put the app in the given theme ("dark" or "light"). */
function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "";
}

/** What a deep link prefill on the print screen carries (plan phase 8). */
type PrintPrefill = { printer?: string; copies?: number };

type View =
  | { name: "list" }
  | { name: "print"; template: AppTemplate; prefill?: PrintPrefill }
  | { name: "edit"; template: AppTemplate }
  | { name: "document-edit"; template: AppTemplate }
  | { name: "settings" };

function TemplatesScreen({
  templates,
  recent,
  reprintingId,
  onPrint,
  onEdit,
  onNew,
  onReprint,
  storageError,
}: {
  templates: AppTemplate[];
  recent: RecentJob[];
  /** The job whose reprint is running, if any. */
  reprintingId: string | null;
  onPrint: (t: AppTemplate) => void;
  onEdit: (t: AppTemplate) => void;
  onNew: () => void;
  onReprint: (job: RecentJob) => void;
  /** A local-storage failure, in plain words, if there is one. */
  storageError: string | null;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-display font-semibold tracking-tight">
          PrintNinja
        </h1>
        <p className="text-body text-muted-foreground">
          Pick a template, enter the data, print.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {t.name}
                  <Badge
                    variant={t.track === "scene" ? "default" : "secondary"}
                  >
                    {t.track === "scene" ? "scene" : "document"}
                  </Badge>
                </CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => onEdit(t)}>
                  Edit
                </Button>
                <Button onClick={() => onPrint(t)}>Print</Button>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold">Recent jobs</h2>
          <div className="flex flex-col gap-2">
            {recent.map((j) => {
              const entry = RESULT_WORDS[j.result.result] ?? {
                word: j.result.result,
                tone: "danger" as const,
              };
              const busy = reprintingId === j.id;
              const failed =
                j.result.result === "failed" ||
                j.result.result === "wrong_mode_suspected";
              return (
                <div
                  key={j.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-body font-medium">
                      {j.templateName}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {jobTime(j.at)} · {j.copies} cop
                      {j.copies === 1 ? "y" : "ies"} · {j.profile}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`rounded-md px-2 py-1 text-caption font-medium ${toneClass(entry.tone)}`}
                    >
                      {entry.word}
                      {j.result.result === "partially_printed" &&
                      j.result.counts
                        ? ` — ${j.result.counts[0]} of ${j.result.counts[1]}`
                        : ""}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onReprint(j)}
                    >
                      {busy ? "Printing…" : failed ? "Retry" : "Reprint"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex items-center justify-between gap-4">
        {storageError ? (
          <p className="text-caption text-danger">
            Local storage: {storageError}
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">
            Templates and recent jobs are saved on this computer.
          </p>
        )}
        <Button variant="outline" onClick={onNew}>
          New template
        </Button>
      </div>
    </main>
  );
}

function App() {
  const [templates, setTemplates] = useState<AppTemplate[]>(starters);
  const [recent, setRecent] = useState<RecentJob[]>([]);
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "list" });
  const [newOpen, setNewOpen] = useState(false);
  /** A deep link that could not be honoured, in plain words. */
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  // The local store: what the user saved comes back on start.
  useEffect(() => {
    loadTemplates()
      .then((rows) => {
        if (rows.length > 0) setTemplates((ts) => mergeTemplates(ts, rows));
      })
      .catch((e) => setStorageError(String(e)));
    loadRecentJobs()
      .then((rows) => setRecent(rows.map(fromStoredJob)))
      .catch((e) => setStorageError(String(e)));
    // The appearance the settings screen saved; dark until it says so.
    loadSettings()
      .then((rows) => applyTheme(rows.theme ?? "dark"))
      .catch(() => applyTheme("dark"));
  }, []);

  const recordJob = (j: RecentJob) => {
    setRecent((rs) => [j, ...rs].slice(0, RECENT_LIMIT));
    void rememberJob(toStoredJob(j)).catch((e) => setStorageError(String(e)));
  };

  /** Print the same job again — its frozen template, data and transport. */
  const reprint = async (job: RecentJob) => {
    setReprintingId(job.id);
    let result: JobReport;
    try {
      result = await printJob(
        JSON.stringify(job.template),
        job.profile,
        job.data,
        job.copies,
        job.transport,
      );
    } catch (e) {
      result = { result: "failed", counts: null, reason: String(e) };
    }
    setRecent((rs) =>
      rs.map((j) => (j.id === job.id ? { ...j, result, at: Date.now() } : j)),
    );
    setReprintingId(null);
  };

  const upsert = (t: AppTemplate) => {
    setTemplates((ts) =>
      ts.some((x) => x.id === t.id)
        ? ts.map((x) => (x.id === t.id ? t : x))
        : [...ts, t],
    );
    saveTemplate(toStoredTemplate(t)).catch((e) => setStorageError(String(e)));
  };

  const newScene = () => {
    const t: AppTemplate = {
      id: `user-${Date.now().toString(36)}`,
      name: "New label",
      description: "A 40 × 50 mm label.",
      track: "scene",
      template: blankTemplate(),
      sample: '[{"name":"Item 1"}]',
    };
    setNewOpen(false);
    setView({ name: "edit", template: t });
  };

  const newDocument = () => {
    setNewOpen(false);
    setView({ name: "document-edit", template: blankDocument() });
  };

  const editTemplate = (t: AppTemplate) =>
    setView(
      t.track === "scene"
        ? { name: "edit", template: t }
        : { name: "document-edit", template: t },
    );

  return (
    <div className="min-h-dvh-safe bg-background">
      {/* A link can arrive on any view, so the error sits above them all. */}
      {deepLinkError && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 border-b border-danger/40 bg-danger-soft px-6 py-3">
          <p className="text-body text-danger">{deepLinkError}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeepLinkError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}
      <DeepLinkListener
        onPrint={({ template, printer, copies }) =>
          setView({
            name: "print",
            template,
            prefill: {
              printer: printer ?? undefined,
              copies: copies ?? undefined,
            },
          })
        }
        onError={setDeepLinkError}
      />
      {view.name === "print" ? (
        <PrintScreen
          starter={view.template}
          prefill={view.prefill}
          onBack={() => setView({ name: "list" })}
          onJob={recordJob}
        />
      ) : view.name === "edit" ? (
        <EditorScreen
          initial={view.template}
          onBack={() => setView({ name: "list" })}
          onSave={(t) => {
            upsert(t);
            setView({ name: "list" });
          }}
        />
      ) : view.name === "settings" ? (
        <SettingsScreen onBack={() => setView({ name: "list" })} />
      ) : view.name === "document-edit" ? (
        <DocumentEditorScreen
          initial={view.template}
          onBack={() => setView({ name: "list" })}
          onSave={(t) => {
            upsert(t);
            setView({ name: "list" });
          }}
        />
      ) : (
        <>
          <div className="flex justify-end p-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView({ name: "settings" })}
            >
              Settings
            </Button>
          </div>
          <TemplatesScreen
            templates={templates}
            recent={recent}
            reprintingId={reprintingId}
            onPrint={(t) => setView({ name: "print", template: t })}
            onEdit={editTemplate}
            onNew={() => setNewOpen(true)}
            onReprint={(j) => void reprint(j)}
            storageError={storageError}
          />
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New template</DialogTitle>
                <DialogDescription>
                  Which track does it use? The track is fixed by the template's
                  format.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Button onClick={newScene}>
                  Scene — labels, rolls and pages
                </Button>
                <Button variant="secondary" onClick={newDocument}>
                  Document — HTML/CSS
                </Button>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setNewOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

export default App;
