import { useState } from "react";
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
import { EditorScreen } from "@/screens/editor-screen";
import { PrintScreen } from "@/screens/print-screen";
import { starters, type AppTemplate } from "@/templates";

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

type View =
  | { name: "list" }
  | { name: "print"; template: AppTemplate }
  | { name: "edit"; template: AppTemplate };

function TemplatesScreen({
  templates,
  onPrint,
  onEdit,
  onNew,
}: {
  templates: AppTemplate[];
  onPrint: (t: AppTemplate) => void;
  onEdit: (t: AppTemplate) => void;
  onNew: () => void;
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
                {t.track === "scene" && (
                  <Button variant="secondary" onClick={() => onEdit(t)}>
                    Edit
                  </Button>
                )}
                <Button onClick={() => onPrint(t)}>Print</Button>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-caption text-muted-foreground">
          Edited templates live in memory for now; on-disk saving lands in a
          later increment.
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
  const [view, setView] = useState<View>({ name: "list" });
  const [newOpen, setNewOpen] = useState(false);

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

  return (
    <div className="min-h-dvh-safe bg-background">
      {view.name === "print" ? (
        <PrintScreen
          starter={view.template}
          onBack={() => setView({ name: "list" })}
        />
      ) : view.name === "edit" ? (
        <EditorScreen
          initial={view.template}
          onBack={() => setView({ name: "list" })}
          onSave={(t) => {
            upsert({ ...t, track: "scene" });
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
            onPrint={(t) => setView({ name: "print", template: t })}
            onEdit={(t) => setView({ name: "edit", template: t })}
            onNew={() => setNewOpen(true)}
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
                <Button variant="secondary" disabled>
                  Document — HTML/CSS (next increment)
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
