/**
 * The HTML/CSS document editor v1 (plan phase 7): the document's code,
 * the paper size, the sample data, and a live browser preview — the
 * first record substituted the way the print does it (plan §5.3). A
 * richer CSS designer toolbar lands post-v1.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
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
import { withTemplateStyles } from "@/lib/tailwind";
import {
  bindingNames,
  type FontFormat,
  type TemplateFont,
} from "@/scene/schema";
import type { AppTemplate } from "@/templates";

const PRESETS: { name: string; w: number; h: number }[] = [
  { name: "A4", w: 210, h: 297 },
  { name: "A5", w: 148, h: 210 },
  { name: "Letter", w: 215.9, h: 279.4 },
];

/** Fonts ride inside the template JSON on every prepare and print, so a
 * cap keeps that payload sane. */
const FONT_MAX_BYTES = 2 * 1024 * 1024;

/** The `@font-face` format a font file name's extension means. */
function fontFormat(name: string): FontFormat | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "ttf") return "truetype";
  if (ext === "otf") return "opentype";
  if (ext === "woff") return "woff";
  if (ext === "woff2") return "woff2";
  return null;
}

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
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name);
  const [html, setHtml] = useState(initial.template.html ?? "");
  const [width, setWidth] = useState(initial.template.media.width_mm);
  const [height, setHeight] = useState(paperHeight(initial));
  const [sample, setSample] = useState(initial.sample);
  const [fonts, setFonts] = useState<TemplateFont[]>(
    initial.template.fonts ?? [],
  );
  const [fontError, setFontError] = useState<string | null>(null);
  const [fontInput, setFontInput] = useState<HTMLInputElement | null>(null);

  const bindings = useMemo(() => bindingNames(html), [html]);
  const filled = useMemo(() => previewHtml(html, sample), [html, sample]);

  // The preview shows the same styles the print will: the document's
  // embedded fonts and Tailwind classes are compiled and injected the
  // way the print screen does, so what the iframe shows is what the
  // page will be.
  const [previewDoc, setPreviewDoc] = useState(filled);
  useEffect(() => {
    let live = true;
    void withTemplateStyles(filled, fonts).then((doc) => {
      if (live) setPreviewDoc(doc);
    });
    return () => {
      live = false;
    };
  }, [filled, fonts]);

  /** A font file the user picks: read it as base64 and attach it to the
   * template under the file name's stem as its font-family. Re-picking a
   * file with the same family replaces the earlier upload. */
  const addFont = async (f: File) => {
    const format = fontFormat(f.name);
    if (!format) {
      setFontError(t("editor.font_unsupported", { file: f.name }));
      return;
    }
    if (f.size > FONT_MAX_BYTES) {
      setFontError(t("editor.font_too_large", { file: f.name }));
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      });
      const family = f.name.replace(/\.[^.]+$/, "");
      const data = dataUrl.split(",")[1] ?? "";
      setFontError(null);
      setFonts((fs) => [
        ...fs.filter((x) => x.family !== family),
        { family, format, data },
      ]);
    } catch (e) {
      setFontError(String(e));
    }
  };

  const save = () =>
    onSave({
      id: initial.id,
      name: name.trim() || t("editor.untitled_document"),
      description: initial.description,
      track: "document",
      template: {
        format: "html",
        media: { kind: "page", width_mm: width, height_mm: height },
        elements: [],
        html,
        fonts: fonts.length > 0 ? fonts : undefined,
      },
      sample,
    });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader title={t("editor.document_title")}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t("editor.back")}
        </Button>
        <Badge variant="secondary">document</Badge>
        <Button onClick={save}>{t("editor.save_template")}</Button>
      </PageHeader>

      <div className="flex flex-col gap-1">
        <Label htmlFor="d-name">{t("common.name")}</Label>
        <Input
          id="d-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("editor.html_css")}</CardTitle>
              <CardDescription>
                {t("editor.html_css_note", { field: "{{field}}" })}
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
                    {t("editor.bindings")}
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
              <CardTitle>{t("editor.fonts")}</CardTitle>
              <CardDescription>{t("editor.fonts_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fontInput?.click()}
                >
                  {t("editor.add_font")}
                </Button>
                <input
                  ref={setFontInput}
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void addFont(f);
                    e.target.value = "";
                  }}
                />
              </div>
              {fonts.length > 0 && (
                <div className="flex flex-col gap-1">
                  {fonts.map((f) => (
                    <div
                      key={f.family}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-1.5"
                    >
                      <span className="font-mono text-body-sm">{f.family}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setFonts((fs) =>
                            fs.filter((x) => x.family !== f.family),
                          )
                        }
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {fontError && (
                <div className="rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger">
                  {fontError}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("editor.paper")}</CardTitle>
              <CardDescription>{t("editor.paper_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  id="p-w"
                  label={t("editor.width_mm")}
                  value={width}
                  onChange={setWidth}
                />
                <NumField
                  id="p-h"
                  label={t("editor.height_mm")}
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
              <CardTitle>{t("editor.sample_data")}</CardTitle>
              <CardDescription>{t("editor.sample_data_note")}</CardDescription>
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
            <CardTitle>{t("editor.preview")}</CardTitle>
            <CardDescription>
              {t("editor.live_preview", { width, height })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <iframe
              title={t("editor.live_preview_iframe")}
              sandbox=""
              srcDoc={previewDoc}
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
