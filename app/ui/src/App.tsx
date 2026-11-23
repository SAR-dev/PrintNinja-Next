import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PrintScreen } from "@/screens/print-screen";
import { starters, type StarterTemplate } from "@/templates";

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

function TemplatesScreen({ onOpen }: { onOpen: (t: StarterTemplate) => void }) {
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
        {starters.map((t) => (
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
              <Button onClick={() => onOpen(t)}>Print</Button>
            </CardHeader>
          </Card>
        ))}
      </div>

      <p className="text-caption text-muted-foreground">
        Templates, settings and recent jobs are saved on this machine in a later
        increment.
      </p>
    </main>
  );
}

function App() {
  const [open, setOpen] = useState<StarterTemplate | null>(null);
  return (
    <div className="min-h-dvh-safe bg-background">
      {open ? (
        <PrintScreen starter={open} onBack={() => setOpen(null)} />
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
          <TemplatesScreen onOpen={setOpen} />
        </>
      )}
    </div>
  );
}

export default App;
