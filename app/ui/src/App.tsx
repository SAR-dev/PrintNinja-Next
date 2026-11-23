import { useState } from "react";
import { printJob, type JobReport } from "@/api";
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
import { DocumentEditorScreen } from "@/screens/document-editor-screen";
import { EditorScreen } from "@/screens/editor-screen";
import { PrintScreen } from "@/screens/print-screen";
import { RESULT_WORDS, toneClass } from "@/result-words";
import {
  blankDocument,
  starters,
  type AppTemplate,
  type RecentJob,
} from "@/templates";

/** How many jobs the recent list remembers. */
const RECENT_LIMIT = 10;

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

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

type View =
  | { name: "list" }
  | { name: "print"; template: AppTemplate }
  | { name: "edit"; template: AppTemplate }
  | { name: "document-edit"; template: AppTemplate };

function TemplatesScreen({
  templates,
  recent,
  reprintingId,
  onPrint,
  onEdit,
  onNew,
  onReprint,
}: {
  templates: AppTemplate[];
  recent: RecentJob[];
  /** The job whose reprint is running, if any. */
  reprintingId: string | null;
  onPrint: (t: AppTemplate) => void;
  onEdit: (t: AppTemplate) => void;
  onNew: () => void;
  onReprint: (job: RecentJob) => void;
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
        <p className="text-caption text-muted-foreground">
          Templates and recent jobs live in memory for now; on-disk saving lands
          in a later increment.
        </p>
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
  const [view, setView] = useState<View>({ name: "list" });
  const [newOpen, setNewOpen] = useState(false);

  const recordJob = (j: RecentJob) =>
    setRecent((rs) => [j, ...rs].slice(0, RECENT_LIMIT));

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

  const upsert = (t: AppTemplate) =>
    setTemplates((ts) =>
      ts.some((x) => x.id === t.id)
        ? ts.map((x) => (x.id === t.id ? t : x))
        : [...ts, t],
    );

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
      {view.name === "print" ? (
        <PrintScreen
          starter={view.template}
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
              onClick={() => {
                const root = document.documentElement;
                root.dataset.theme = isDark() ? "" : "dark";
              }}
            >
              {isDark() ? "Light" : "Dark"}
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
