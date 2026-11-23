/**
 * The scene editor v1 (plan phase 7): elements, positions (drag on the
 * canvas, or the numbers), styles, data bindings, page settings, and
 * repeating-group settings. The preview is prepared with the same path
 * as the print (plan §3.4) — on the chosen printer, at its own dpi.
 */
import { useEffect, useMemo, useState } from "react";
import {
  listPrinters,
  planJob,
  type PrepareReport,
  type ProfileInfo,
} from "@/api";
import { JobPreview } from "@/components/job-preview";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  allBindings,
  defaultElement,
  ELEMENT_TYPES,
  elementLabel,
  elementsOf,
  withSyncedFields,
  type Container,
  type Selection,
} from "@/scene/editor-model";
import { SceneCanvas } from "@/scene/scene-canvas";
import type {
  Align,
  BarcodeKind,
  Element,
  Media,
  Placement,
  Template,
} from "@/scene/schema";
import type { AppTemplate } from "@/templates";

export interface EditorResult {
  id: string;
  name: string;
  description: string;
  template: Template;
  sample: string;
}

/** Rewrite one element in a container, leaving everything else as is. */
function updateAt(
  template: Template,
  container: Container,
  index: number,
  fn: (el: Element) => Element,
): Template {
  const map = (els: Element[]) =>
    els.map((el, i) => (i === index ? fn(el) : el));
  if (container === "root")
    return { ...template, elements: map(template.elements) };
  return {
    ...template,
    elements: template.elements.map((el, i) =>
      i === container && el.type === "group"
        ? { ...el, items: map(el.items) }
        : el,
    ),
  };
}

export function EditorScreen({
  initial,
  onBack,
  onSave,
}: {
  initial: AppTemplate;
  onBack: () => void;
  onSave: (t: EditorResult) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [template, setTemplate] = useState<Template>(() =>
    structuredClone(initial.template),
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [printers, setPrinters] = useState<ProfileInfo[]>([]);
  const [printer, setPrinter] = useState<string>("");
  const [preview, setPreview] = useState<PrepareReport | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    listPrinters()
      .then((ps) => {
        setPrinters(ps);
        setPrinter((p) => p || ps[0]?.model || "");
      })
      .catch(() => setPreviewError("The printer list could not be loaded."));
  }, []);

  const bindings = useMemo(() => allBindings(template), [template]);
  const selected = selection
    ? elementsOf(template, selection.container)[selection.index]
    : null;
  /** The group's own index at the root, when the selection is a group. */
  const groupIndex = selected ? template.elements.indexOf(selected) : -1;

  const setMedia = (media: Media) => setTemplate((t) => ({ ...t, media }));
  const moveElement = (
    container: Container,
    index: number,
    x_mm: number,
    y_mm: number,
  ) =>
    setTemplate((t) =>
      updateAt(t, container, index, (el) => ({
        ...el,
        at: { ...el.at, x_mm, y_mm },
      })),
    );
  const updateSelected = (fn: (el: Element) => Element) => {
    if (!selection) return;
    const { container, index } = selection;
    setTemplate((t) => updateAt(t, container, index, fn));
  };
  const addElement = (container: Container, type: string) => {
    const index = elementsOf(template, container).length;
    const newEl = defaultElement(type);
    setTemplate((t) =>
      container === "root"
        ? { ...t, elements: [...t.elements, newEl] }
        : {
            ...t,
            elements: t.elements.map((el, i) =>
              i === container && el.type === "group"
                ? { ...el, items: [...el.items, newEl] }
                : el,
            ),
          },
    );
    setSelection({ container, index });
  };
  const deleteElement = (container: Container, index: number) => {
    setTemplate((t) =>
      container === "root"
        ? { ...t, elements: t.elements.filter((_, i) => i !== index) }
        : {
            ...t,
            elements: t.elements.map((el, i) =>
              i === container && el.type === "group"
                ? { ...el, items: el.items.filter((_, j) => j !== index) }
                : el,
            ),
          },
    );
    setSelection(null);
  };

  const previewJob = async () => {
    setPreparing(true);
    setPreviewError(null);
    try {
      const firstRecord = previewRecord(initial.sample);
      setPreview(
        await planJob(
          JSON.stringify(withSyncedFields(template)),
          printer,
          firstRecord,
          1,
        ),
      );
    } catch (e) {
      setPreview(null);
      setPreviewError(String(e));
    } finally {
      setPreparing(false);
    }
  };

  const save = () =>
    onSave({
      id: initial.id,
      name: name.trim() || "Untitled template",
      description: initial.description,
      template: withSyncedFields(template),
      sample: initial.sample,
    });

  const media = template.media;
  const changeMediaKind = (kind: Media["kind"]) => {
    if (kind === "roll")
      setMedia({ kind, width_mm: media.width_mm, label_height_mm: 30 });
    else if (kind === "page") setMedia({ kind, width_mm: 210, height_mm: 297 });
    else setMedia({ kind: "label", width_mm: media.width_mm, height_mm: 50 });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Templates
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-display font-semibold tracking-tight">
            Edit template
          </h1>
          <Badge>scene</Badge>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-64 flex-col gap-1">
          <Label htmlFor="t-name">Name</Label>
          <Input
            id="t-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button onClick={save}>Save template</Button>
        <Button variant="secondary" onClick={previewJob} disabled={preparing}>
          {preparing ? "Preparing…" : "Preview"}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Page</CardTitle>
              <CardDescription>
                Drag an element to move it; the numbers do the same thing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SceneCanvas
                template={template}
                selection={selection}
                onSelect={setSelection}
                onMove={moveElement}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Media</CardTitle>
              <CardDescription>What the template prints on.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label>Kind</Label>
                <Select
                  value={media.kind}
                  onValueChange={(v) => changeMediaKind(v as Media["kind"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="label">Label — fixed size</SelectItem>
                    <SelectItem value="roll">Roll — cut per label</SelectItem>
                    <SelectItem value="page">Page — paper</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  id="m-w"
                  label="Width (mm)"
                  value={media.width_mm}
                  onChange={(v) => setMedia({ ...media, width_mm: v })}
                />
                <NumField
                  id="m-h"
                  label={
                    media.kind === "roll" ? "Label height (mm)" : "Height (mm)"
                  }
                  value={
                    media.kind === "roll"
                      ? media.label_height_mm
                      : media.height_mm
                  }
                  onChange={(v) =>
                    media.kind === "roll"
                      ? setMedia({ ...media, label_height_mm: v })
                      : setMedia({ ...media, height_mm: v })
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Elements</CardTitle>
              <CardDescription>
                Top to bottom, the order they are drawn.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ElementList
                elements={template.elements}
                selection={selection}
                onSelect={setSelection}
                onDelete={deleteElement}
              />
              <AddElement onAdd={(type) => addElement("root", type)} />
            </CardContent>
          </Card>

          {selected && (
            <Card>
              <CardHeader>
                <CardTitle>Selected element</CardTitle>
                <CardDescription>{elementLabel(selected)}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    id="el-x"
                    label="X (mm)"
                    value={selected.at.x_mm}
                    onChange={(v) =>
                      updateSelected((el) => ({
                        ...el,
                        at: { ...el.at, x_mm: v },
                      }))
                    }
                  />
                  <NumField
                    id="el-y"
                    label="Y (mm)"
                    value={selected.at.y_mm}
                    onChange={(v) =>
                      updateSelected((el) => ({
                        ...el,
                        at: { ...el.at, y_mm: v },
                      }))
                    }
                  />
                </div>

                {selected.type !== "group" && (
                  <PlacementSelect
                    value={selected.page ?? "every"}
                    onChange={(p) =>
                      updateSelected((el) => ({ ...el, page: p }))
                    }
                  />
                )}

                {selected.type === "text" && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <Label>Content</Label>
                      <Textarea
                        rows={2}
                        spellCheck={false}
                        value={selected.content}
                        onChange={(e) =>
                          updateSelected((el) =>
                            el.type === "text"
                              ? { ...el, content: e.target.value }
                              : el,
                          )
                        }
                      />
                      <span className="text-caption text-muted-foreground">
                        {"{{name}}"} fills from the record's fields.
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <NumField
                        id="t-w"
                        label="Width (mm)"
                        value={selected.size.w_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "text"
                              ? { ...el, size: { ...el.size, w_mm: v } }
                              : el,
                          )
                        }
                      />
                      <NumField
                        id="t-h"
                        label="Height (mm)"
                        value={selected.size.h_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "text"
                              ? { ...el, size: { ...el.size, h_mm: v } }
                              : el,
                          )
                        }
                      />
                      <NumField
                        id="t-size"
                        label="Text size (mm)"
                        value={selected.style.size_mm}
                        step={0.5}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "text"
                              ? { ...el, style: { ...el.style, size_mm: v } }
                              : el,
                          )
                        }
                      />
                    </div>
                    <div className="flex items-end gap-3">
                      <div className="flex flex-1 flex-col gap-1">
                        <Label>Align</Label>
                        <Select
                          value={selected.style.align ?? "left"}
                          onValueChange={(v) =>
                            updateSelected((el) =>
                              el.type === "text"
                                ? {
                                    ...el,
                                    style: { ...el.style, align: v as Align },
                                  }
                                : el,
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">Left</SelectItem>
                            <SelectItem value="center">Center</SelectItem>
                            <SelectItem value="right">Right</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex gap-5">
                      <SwitchRow
                        label="Bold"
                        checked={!!selected.style.bold}
                        onCheckedChange={(v) =>
                          updateSelected((el) =>
                            el.type === "text"
                              ? { ...el, style: { ...el.style, bold: v } }
                              : el,
                          )
                        }
                      />
                      <SwitchRow
                        label="Italic"
                        checked={!!selected.style.italic}
                        onCheckedChange={(v) =>
                          updateSelected((el) =>
                            el.type === "text"
                              ? { ...el, style: { ...el.style, italic: v } }
                              : el,
                          )
                        }
                      />
                    </div>
                  </div>
                )}

                {selected.type === "line" && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <NumField
                        id="l-len"
                        label="Length (mm)"
                        value={selected.length_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "line" ? { ...el, length_mm: v } : el,
                          )
                        }
                      />
                      <NumField
                        id="l-th"
                        label="Thickness (mm)"
                        step={0.05}
                        value={selected.thickness_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "line"
                              ? { ...el, thickness_mm: v }
                              : el,
                          )
                        }
                      />
                    </div>
                    <SwitchRow
                      label="Vertical"
                      checked={!!selected.vertical}
                      onCheckedChange={(v) =>
                        updateSelected((el) =>
                          el.type === "line" ? { ...el, vertical: v } : el,
                        )
                      }
                    />
                  </div>
                )}

                {selected.type === "rect" && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <NumField
                        id="r-w"
                        label="Width (mm)"
                        value={selected.size.w_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "rect"
                              ? { ...el, size: { ...el.size, w_mm: v } }
                              : el,
                          )
                        }
                      />
                      <NumField
                        id="r-h"
                        label="Height (mm)"
                        value={selected.size.h_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "rect"
                              ? { ...el, size: { ...el.size, h_mm: v } }
                              : el,
                          )
                        }
                      />
                    </div>
                    <SwitchRow
                      label="Filled"
                      checked={!!selected.fill}
                      onCheckedChange={(v) =>
                        updateSelected((el) =>
                          el.type === "rect" ? { ...el, fill: v } : el,
                        )
                      }
                    />
                  </div>
                )}

                {(selected.type === "barcode" || selected.type === "qr") && (
                  <div className="flex flex-col gap-3">
                    {selected.type === "barcode" && (
                      <div className="grid grid-cols-3 gap-3">
                        <NumField
                          id="b-w"
                          label="Width (mm)"
                          value={selected.size.w_mm}
                          onChange={(v) =>
                            updateSelected((el) =>
                              el.type === "barcode"
                                ? { ...el, size: { ...el.size, w_mm: v } }
                                : el,
                            )
                          }
                        />
                        <NumField
                          id="b-h"
                          label="Height (mm)"
                          value={selected.size.h_mm}
                          onChange={(v) =>
                            updateSelected((el) =>
                              el.type === "barcode"
                                ? { ...el, size: { ...el.size, h_mm: v } }
                                : el,
                            )
                          }
                        />
                        <div className="flex flex-col gap-1">
                          <Label>Kind</Label>
                          <Select
                            value={selected.kind ?? "code128"}
                            onValueChange={(v) =>
                              updateSelected((el) =>
                                el.type === "barcode"
                                  ? { ...el, kind: v as BarcodeKind }
                                  : el,
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="code128">Code 128</SelectItem>
                              <SelectItem value="code39">Code 39</SelectItem>
                              <SelectItem value="code93">Code 93</SelectItem>
                              <SelectItem value="ean13">EAN-13</SelectItem>
                              <SelectItem value="upca">UPC-A</SelectItem>
                              <SelectItem value="itf">ITF</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                    {selected.type === "qr" && (
                      <NumField
                        id="q-h"
                        label="Size (mm)"
                        value={selected.h_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "qr" ? { ...el, h_mm: v } : el,
                          )
                        }
                      />
                    )}
                    <div className="flex flex-col gap-1">
                      <Label>Value</Label>
                      <Input
                        spellCheck={false}
                        value={selected.value}
                        onChange={(e) =>
                          updateSelected((el) =>
                            el.type === "barcode" || el.type === "qr"
                              ? { ...el, value: e.target.value }
                              : el,
                          )
                        }
                      />
                    </div>
                    {selected.type === "barcode" && (
                      <SwitchRow
                        label="Show text under the bars"
                        checked={selected.show_text !== false}
                        onCheckedChange={(v) =>
                          updateSelected((el) =>
                            el.type === "barcode"
                              ? { ...el, show_text: v }
                              : el,
                          )
                        }
                      />
                    )}
                  </div>
                )}

                {selected.type === "image" && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <NumField
                        id="i-w"
                        label="Width (mm)"
                        value={selected.size.w_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "image"
                              ? { ...el, size: { ...el.size, w_mm: v } }
                              : el,
                          )
                        }
                      />
                      <NumField
                        id="i-h"
                        label="Height (mm)"
                        value={selected.size.h_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "image"
                              ? { ...el, size: { ...el.size, h_mm: v } }
                              : el,
                          )
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label>Source</Label>
                      <Input
                        spellCheck={false}
                        value={selected.src}
                        onChange={(e) =>
                          updateSelected((el) =>
                            el.type === "image"
                              ? { ...el, src: e.target.value }
                              : el,
                          )
                        }
                      />
                    </div>
                  </div>
                )}

                {selected.type === "group" && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <NumField
                        id="g-w"
                        label="Column width (mm)"
                        value={selected.w_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "group" ? { ...el, w_mm: v } : el,
                          )
                        }
                      />
                      <NumField
                        id="g-gap"
                        label="Gap (mm)"
                        value={selected.item_gap_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "group"
                              ? { ...el, item_gap_mm: v }
                              : el,
                          )
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label>Rows from</Label>
                      <Input
                        spellCheck={false}
                        value={selected.bind}
                        onChange={(e) =>
                          updateSelected((el) =>
                            el.type === "group"
                              ? { ...el, bind: e.target.value }
                              : el,
                          )
                        }
                      />
                      <span className="text-caption text-muted-foreground">
                        The record field holding this group's rows (a list).
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-body-sm font-medium">Rows</span>
                      <ElementList
                        elements={selected.items}
                        selection={selection}
                        onSelect={setSelection}
                        onDelete={deleteElement}
                        container={groupIndex}
                      />
                      <AddElement
                        onAdd={(type) => addElement(groupIndex, type)}
                        group
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {bindings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Data fields</CardTitle>
                <CardDescription>
                  Every binding the template uses, declared for the job.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {bindings.map((b) => (
                  <Badge key={b} variant="outline">
                    {"{{"}
                    {b}
                    {"}}"}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>
                Prepared on the chosen printer, the same path as the print — one
                record.
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
              {previewError && (
                <div className="rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger">
                  {previewError}
                </div>
              )}
              {preview && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
                    <Badge variant="outline">{preview.path}</Badge>
                    <span>
                      {preview.pages} page{preview.pages === 1 ? "" : "s"} ·{" "}
                      {preview.bytes} B
                    </span>
                  </div>
                  {preview.fallback && (
                    <div className="rounded-md bg-warning-soft px-3 py-2 text-body-sm text-warning">
                      Fell back from the track's preferred path:{" "}
                      {preview.fallback}
                    </div>
                  )}
                  {preview.preview && <JobPreview preview={preview.preview} />}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The element list: select and delete. The draw order is the list
 *  deleting and re-adding — the draw order is the list order. */
function ElementList({
  elements,
  selection,
  onSelect,
  onDelete,
  container = "root",
}: {
  elements: Element[];
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onDelete: (container: Container, index: number) => void;
  container?: Container;
}) {
  return (
    <div className="flex flex-col gap-1">
      {elements.length === 0 && (
        <span className="text-body-sm text-muted-foreground">
          Nothing yet — add the first element below.
        </span>
      )}
      {elements.map((el, i) => {
        const isSel =
          selection?.container === container && selection.index === i;
        return (
          <div
            key={i}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
              isSel ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            }`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-body-sm"
              onClick={() => onSelect(isSel ? null : { container, index: i })}
            >
              {elementLabel(el)}
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 px-2 text-muted-foreground"
              onClick={() => onDelete(container, i)}
            >
              Delete
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function AddElement({
  onAdd,
  group = false,
}: {
  onAdd: (type: string) => void;
  group?: boolean;
}) {
  const types = group
    ? ["text", "line", "rect", "barcode", "qr", "image"]
    : ELEMENT_TYPES;
  return (
    <Select onValueChange={(v) => onAdd(v)}>
      <SelectTrigger>
        <SelectValue placeholder={group ? "Add to row…" : "Add element…"} />
      </SelectTrigger>
      <SelectContent>
        {types.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Where a root element sits in a multi-page output. Groups must flow. */
function PlacementSelect({
  value,
  onChange,
}: {
  value: Placement;
  onChange: (p: Placement) => void;
}) {
  const isOnly = typeof value === "object";
  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-1 flex-col gap-1">
        <Label>Page</Label>
        <Select
          value={isOnly ? "only" : value}
          onValueChange={(v) =>
            onChange(v === "only" ? { only: 2 } : (v as Placement))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="every">Every page</SelectItem>
            <SelectItem value="first">First page</SelectItem>
            <SelectItem value="last">Last page</SelectItem>
            <SelectItem value="only">Only page…</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isOnly && (
        <div className="flex w-20 flex-col gap-1">
          <Label>Number</Label>
          <Input
            type="number"
            min={1}
            value={value.only}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (Number.isFinite(n))
                onChange({ only: Math.max(1, Math.round(n)) });
            }}
          />
        </div>
      )}
    </div>
  );
}

function NumField({
  id,
  label,
  value,
  onChange,
  step = 0.1,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
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

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
      <Label className="cursor-pointer text-body-sm">{label}</Label>
    </div>
  );
}

/**
 * The editor previews one record: the first of the sample data, when
 * the sample parses, else the sample as is (a single record object).
 */
function previewRecord(sample: string): string {
  try {
    const arr: unknown = JSON.parse(sample);
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      typeof arr[0] === "object" &&
      arr[0] !== null
    ) {
      return JSON.stringify(arr[0]);
    }
  } catch {
    // not an array — treat the sample as one record
  }
  return sample;
}
