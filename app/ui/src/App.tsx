import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "destructive",
  "ghost",
  "link",
] as const;

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

function App() {
  return (
    <div className="min-h-dvh-safe bg-background">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-display font-semibold tracking-tight">
            PrintNinja (next)
          </h1>
          <p className="text-body text-muted-foreground">
            Phase 0 skeleton — design system port
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Buttons</CardTitle>
            <CardDescription>
              One of every variant from the ported kit
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {BUTTON_VARIANTS.map((variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              Status vocabulary: tint + word, never colour alone
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-md bg-success-soft px-3 py-2 text-success">
              <span className="text-body font-medium">Printer</span>
              <Badge variant="success">Ready</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>
              Light and dark are wired via data-theme on &lt;html&gt; — the
              token set in index.css swaps under :root[data-theme="dark"].
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => {
                const root = document.documentElement;
                root.dataset.theme = isDark() ? "" : "dark";
              }}
            >
              {isDark() ? "Switch to light" : "Switch to dark"}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default App;
