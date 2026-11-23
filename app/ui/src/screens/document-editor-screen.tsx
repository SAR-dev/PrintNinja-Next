/**
 * The HTML/CSS document editor v1 (plan phase 7): the document's code,
 * the paper size, the sample data, and a live browser preview — the
 * first record substituted the way the print does it (plan §5.3). A
 * richer CSS designer toolbar lands post-v1.
 */
import { useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { bindingNames } from "@/scene/schema";
import type { AppTemplate } from "@/templates";

const PRESETS: { name: string; w: number; h: number }[] = [
  { name: "A4", w: 210, h: 297 },
  { name: "A5", w: 148, h: 210 },
  { name: "Letter", w: 215.9, h: 279.4 },
];

/**
 * The first record's values in the document — the same rule the
 * renderer's substitute applies: a known field becomes its text, a
 * missing field becomes empty. With no parseable record, the
 * document is shown as written, so its bindings stay visible.
 */
function previewHtml(html: string, sample: string): string {
  let record: Record<string, unknown> | null = null;
  try {
    const arr: unknown = JSON.parse(sample);
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      typeof arr[0] === "object" &&
      arr[0] !== null
    ) {
      record = arr[0] as Record<string, unknown>;
    }
  } catch {
    // not an array of records — show the document as written
  }
  if (!record) return html;
  const text = (v: unknown) =>
    v === null || v === undefined
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  return html.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_m, n: string) =>
    n in record ? text(record[n]) : "",
  );
}

export function DocumentEditorScreen({
  initial,
  onBack,
  onSave,
}: {
  initial: AppTemplate;
  onBack: () => void;
  onSave: (t: AppTemplate) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [html, setHtml] = useState(initial.template.html ?? "");
  const [width, setWidth] = useState(initial.template.media.width_mm);
  const [height, setHeight] = useState(paperHeight(initial));
  const [sample, setSample] = useState(initial.sample);

  const bindings = useMemo(() => bindingNames(html), [html]);
  const filled = useMemo(() => previewHtml(html, sample), [html, sample]);

  const save = () =>
    onSave({
      id: initial.id,
      name: name.trim() || "Untitled document",
      description: initial.description,
      track: "document",
      template: {
        format: "html",
        media: { kind: "page", width_mm: width, height_mm: height },
        elements: [],
        html,
      },
      sample,
    });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Templates
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-display font-semibold tracking-tight">
            Edit document
          </h1>
          <Badge variant="secondary">document</Badge>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-64 flex-col gap-1">
          <Label htmlFor="d-name">Name</Label>
          <Input
            id="d-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button onClick={save}>Save template</Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>HTML/CSS</CardTitle>
              <CardDescription>
                One record per page; {"{{field}}"} fills from the record.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Textarea
                rows={16}
                spellCheck={false}
                className="font-mono text-body-sm"
                value={html}
                onChange={(e) => setHtml(e.target.value)}
              />
              {bindings.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-caption text-muted-foreground">
                    Bindings:
                  </span>
                  {bindings.map((b) => (
                    <Badge key={b} variant="outline">
                      {"{{"}
                      {b}
                      {"}}"}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Paper</CardTitle>
              <CardDescription>
                The page the document prints on, in millimetres.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  id="p-w"
                  label="Width (mm)"
                  value={width}
                  onChange={setWidth}
                />
                <NumField
                  id="p-h"
                  label="Height (mm)"
                  value={height}
                  onChange={setHeight}
                />
              </div>
              <div className="flex gap-2">
                {PRESETS.map((p) => (
                  <Button
                    key={p.name}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setWidth(p.w);
                      setHeight(p.h);
                    }}
                  >
                    {p.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sample data</CardTitle>
              <CardDescription>
                The records the print screen starts with; the first one is what
                the preview shows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                rows={4}
                spellCheck={false}
                className="font-mono text-body-sm"
                value={sample}
                onChange={(e) => setSample(e.target.value)}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {width} × {height} mm — the first record, live.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <iframe
              title="Live preview of the document"
              sandbox=""
              srcDoc={filled}
              className="h-[560px] w-full rounded-sm border border-border bg-white"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function paperHeight(initial: AppTemplate): number {
  const m = initial.template.media;
  return m.kind === "roll" ? m.label_height_mm : m.height_mm;
}

function NumField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={0.1}
        min={0}
        value={value}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </div>
  );
}
