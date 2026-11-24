/**
 * The scene editor v1 (plan phase 7): elements, positions (drag on the
 * canvas, or the numbers), styles, data bindings, page settings, and
 * repeating-group settings. The preview is prepared with the same path
 * as the print (plan §3.4) — on the chosen printer, at its own dpi.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { icons } from "@/lib/icons";
import {
  listPrinters,
  planJob,
  type PrepareReport,
  type ProfileInfo,
} from "@/api";
import { AddElement, ElementList } from "@/components/editor/element-list";
import {
  NumField,
  PlacementSelect,
  SwitchRow,
} from "@/components/editor/fields";
import { JobPreview } from "@/components/job-preview";
import { PageHeader } from "@/components/page-header";
import { ActionMenu } from "@/components/ui/action-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
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
import {
  allBindings,
  boundsMm,
  clampToBounds,
  defaultElement,
  elementLabel,
  elementsOf,
  getAt,
  insertAt,
  removeAt,
  samePath,
  updateAt,
  withSyncedFields,
  type Path,
  type Selection,
} from "@/scene/editor-model";
import { SceneCanvas } from "@/scene/scene-canvas";
import type {
  Align,
  BarcodeKind,
  Element,
  Media,
  Template,
} from "@/scene/schema";
import type { AppTemplate } from "@/templates";

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Where an element at `path` goes when moved to (x_mm, y_mm): when it
 * sits in a frame, clamped so it stays inside the frame's size — the
 * scene validation rejects a child that leaves its frame.
 */
function frameClamped(
  t: Template,
  path: Path,
  el: Element,
  x_mm: number,
  y_mm: number,
): { x_mm: number; y_mm: number } {
  const parent = getAt(t, path.slice(0, -1));
  if (parent?.type !== "frame")
    return { x_mm: round1(x_mm), y_mm: round1(y_mm) };
  const [, , bw, bh] = boundsMm(el);
  return clampToBounds(round1(x_mm), round1(y_mm), bw, bh, {
    w: parent.size.w_mm,
    h: parent.size.h_mm,
  });
}

export function EditorScreen({
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
  const [description, setDescription] = useState(initial.description);
  const [template, setTemplate] = useState<Template>(() =>
    structuredClone(initial.template),
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showSample, setShowSample] = useState(true);
  const [printers, setPrinters] = useState<ProfileInfo[]>([]);
  const [printer, setPrinter] = useState<string>("");
  const [preview, setPreview] = useState<PrepareReport | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  // On the phone the properties are a bottom sheet: keep the canvas
  // in view when an element is picked from the list further down.
  useEffect(() => {
    if (!selection || !window.matchMedia("(max-width: 767px)").matches) return;
    document
      .querySelector('[data-slot="app-main"]')
      ?.scrollTo({ top: 0, behavior: "instant" });
  }, [selection]);

  useEffect(() => {
    listPrinters()
      .then((ps) => {
        setPrinters(ps);
        setPrinter((p) => p || ps[0]?.model || "");
      })
      .catch(() => setPreviewError(t("editor.printer_list_error")));
  }, []);

  const bindings = useMemo(() => allBindings(template), [template]);
  const selected = selection ? (getAt(template, selection.path) ?? null) : null;
  /** The group or frame the selected element sits in, when not at the
   * root — its name goes in the panel header and its coordinates are
   * relative to it. */
  const selectedParent =
    selection && selection.path.length > 1
      ? (getAt(template, selection.path.slice(0, -1)) ?? null)
      : null;

  /** The first record of the sample data, for the canvas's live
   *  barcode/QR substitution (plan step 2). `null` when the sample
   *  does not parse to a record. */
  const sampleRecord = useMemo<Record<string, unknown> | null>(
    () => firstRecordOf(initial.sample),
    [initial.sample],
  );
  const dpi = printers.find((p) => p.model === printer)?.dpi ?? null;

  /** The dot in the header: the loaded template has changed. */
  const dirty = useMemo(() => {
    const saved = JSON.stringify(withSyncedFields(initial.template));
    const current = JSON.stringify(withSyncedFields(template));
    return saved !== current || name.trim() !== initial.name;
  }, [initial, name, template]);

  // -- undo/redo: one step per action, bursts of the same key (a drag,
  // typing in one field) coalesced within 800 ms.
  const [past, setPast] = useState<Template[]>([]);
  const [future, setFuture] = useState<Template[]>([]);
  const lastPush = useRef<{ key: string; at: number } | null>(null);
  const pushHistory = (key: string) => {
    const now = Date.now();
    const last = lastPush.current;
    if (last && last.key === key && now - last.at < 800) return;
    lastPush.current = { key, at: now };
    setPast((p) => [...p.slice(-99), template]);
    setFuture([]);
  };
  const commit = (fn: (t: Template) => Template, key: string) => {
    pushHistory(key);
    setTemplate(fn);
  };
  const undo = () => {
    if (past.length === 0) return;
    lastPush.current = null;
    setFuture((f) => [template, ...f]);
    setTemplate(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (future.length === 0) return;
    lastPush.current = null;
    setPast((p) => [...p, template]);
    setTemplate(future[0]);
    setFuture((f) => f.slice(1));
  };

  /** Move an element one place among its siblings (draw order). */
  const moveSibling = (path: Path, delta: number) => {
    const index = path[path.length - 1];
    const parent = path.slice(0, -1);
    const target = index + delta;
    if (target < 0 || target >= elementsOf(template, parent).length) return;
    commit(
      (t) => {
        const el = getAt(t, path);
        return el ? insertAt(removeAt(t, path), [...parent, target], el) : t;
      },
      `move:${path.join("/")}`,
    );
    if (selection && samePath(selection.path, path))
      setSelection({ path: [...parent, target] });
  };

  const setMedia = (media: Media) => commit((t) => ({ ...t, media }), "media");
  const moveElement = (path: Path, x_mm: number, y_mm: number) =>
    setTemplate((t) =>
      updateAt(t, path, (el) => {
        const at = frameClamped(t, path, el, x_mm, y_mm);
        return { ...el, at };
      }),
    );
  const startDrag = (path: Path) => pushHistory(`drag:${path.join("/")}`);
  const resizeElement = (
    path: Path,
    x_mm: number,
    y_mm: number,
    w_mm: number,
    h_mm: number,
  ) =>
    commit(
      (t) =>
        updateAt(t, path, (el) => {
          if (!("size" in el)) return el;
          const parent = getAt(t, path.slice(0, -1));
          let x = x_mm;
          let y = y_mm;
          let w = w_mm;
          let h = h_mm;
          if (parent?.type === "frame") {
            x = Math.max(0, x);
            y = Math.max(0, y);
            w = Math.min(w, parent.size.w_mm - x);
            h = Math.min(h, parent.size.h_mm - y);
          }
          return {
            ...el,
            at: { x_mm: round1(x), y_mm: round1(y) },
            size: { ...el.size, w_mm: round1(w), h_mm: round1(h) },
          };
        }),
      `resize:${path.join("/")}`,
    );
  /** The selected element's position, for the arrow-key nudge. */
  const nudge = (dx: number, dy: number) => {
    if (!selection) return;
    const path = selection.path;
    commit(
      (t) =>
        updateAt(t, path, (el) => {
          const at = frameClamped(
            t,
            path,
            el,
            el.at.x_mm + dx,
            el.at.y_mm + dy,
          );
          return { ...el, at };
        }),
      `nudge:${path.join("/")}`,
    );
  };
  const updateSelected = (fn: (el: Element) => Element) => {
    if (!selection) return;
    const key = `sel:${selection.path.join("/")}`;
    commit((t) => updateAt(t, selection.path, fn), key);
  };
  const addElement = (container: Path, type: string) => {
    const path = [...container, elementsOf(template, container).length];
    const newEl = defaultElement(type);
    commit((t) => insertAt(t, path, newEl), `add:${container.join("/")}`);
    setSelection({ path });
  };
  const deleteElement = (path: Path) => {
    commit((t) => removeAt(t, path), `del:${path.join("/")}`);
    setSelection(null);
  };

  // Ctrl/Cmd+Z / Shift+Z (or Ctrl+Y) undo/redo; Delete removes the
  // selection; the arrow keys nudge it 0.1 mm (Shift: 1 mm).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y") && !e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
      // Never steal keys from a text input.
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, select")
      )
        return;
      if (!selection) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteElement(selection.path);
        return;
      }
      const step = e.shiftKey ? 1 : 0.1;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;
      e.preventDefault();
      nudge(dx, dy);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
      name: name.trim() || t("editor.untitled_template"),
      description: description.trim(),
      track: "scene",
      template: withSyncedFields(template),
      sample: initial.sample,
    });

  const media = template.media;
  const sizeLabel =
    media.kind === "roll"
      ? t("editor.template_size", {
          w: media.width_mm,
          h: media.label_height_mm,
        })
      : t("editor.template_size", {
          w: media.width_mm,
          h: media.height_mm,
        });
  const changeMediaKind = (kind: Media["kind"]) => {
    if (kind === "roll")
      setMedia({ kind, width_mm: media.width_mm, label_height_mm: 30 });
    else if (kind === "page") setMedia({ kind, width_mm: 210, height_mm: 297 });
    else setMedia({ kind: "label", width_mm: media.width_mm, height_mm: 50 });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title={t("editor.title")}
        titleControl={
          <div className="flex min-w-0 items-center gap-2">
            <Input
              id="t-name"
              aria-label={t("common.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-w-64"
            />
            {dirty && (
              <span
                role="img"
                aria-label={t("editor.unsaved")}
                title={t("editor.unsaved")}
                className="h-2 w-2 shrink-0 rounded-full bg-warning"
              />
            )}
          </div>
        }
        back={{ onClick: onBack, label: t("common.back") }}
      >
        <Badge>scene</Badge>
        <IconButton
          icon="undo"
          label={t("editor.undo")}
          variant="ghost"
          onClick={undo}
          disabled={past.length === 0}
        />
        <IconButton
          icon="redo"
          label={t("editor.redo")}
          variant="ghost"
          onClick={redo}
          disabled={future.length === 0}
        />
        <Button onClick={save}>
          <icons.save aria-hidden="true" className="h-4 w-4" />
          {t("editor.save_template")}
        </Button>
        <Button variant="secondary" onClick={previewJob} disabled={preparing}>
          {preparing ? t("editor.previewing") : t("editor.preview")}
        </Button>
        <ActionMenu
          items={[
            {
              label: sizeLabel,
              icon: "rect",
              disabled: true,
              onSelect: () => undefined,
            },
            {
              label: t("editor.save_template"),
              icon: "save",
              onSelect: save,
              separator: true,
            },
          ]}
          label={t("common.more")}
        />
      </PageHeader>

      <div className="flex flex-col gap-1">
        <Label htmlFor="t-description">{t("common.description")}</Label>
        <Input
          id="t-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("editor.page")}</CardTitle>
              <CardDescription>{t("editor.page_note")}</CardDescription>
            </CardHeader>
            <CardContent>
              <SceneCanvas
                template={template}
                selection={selection}
                onSelect={setSelection}
                onMove={moveElement}
                onDragStart={startDrag}
                onResize={resizeElement}
                record={sampleRecord}
                showSample={showSample}
                dpi={dpi}
              />
              <div className="mt-3">
                <SwitchRow
                  label={
                    showSample
                      ? t("editor.show_sample_data")
                      : t("editor.show_fields")
                  }
                  checked={showSample}
                  onCheckedChange={setShowSample}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("editor.media")}</CardTitle>
              <CardDescription>{t("editor.media_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label>{t("editor.kind")}</Label>
                <Select
                  value={media.kind}
                  onValueChange={(v) => changeMediaKind(v as Media["kind"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="label">
                      {t("editor.kind_label")}
                    </SelectItem>
                    <SelectItem value="roll">
                      {t("editor.kind_roll")}
                    </SelectItem>
                    <SelectItem value="page">
                      {t("editor.kind_page")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  id="m-w"
                  label={t("editor.width_mm")}
                  value={media.width_mm}
                  onChange={(v) => setMedia({ ...media, width_mm: v })}
                />
                <NumField
                  id="m-h"
                  label={
                    media.kind === "roll"
                      ? t("editor.label_height_mm")
                      : t("editor.height_mm")
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
              <CardTitle>{t("editor.elements")}</CardTitle>
              <CardDescription>{t("editor.elements_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ElementList
                elements={template.elements}
                basePath={[]}
                selection={selection}
                onSelect={setSelection}
                onMove={moveSibling}
                onDelete={deleteElement}
              />
              <AddElement onAdd={(type) => addElement([], type)} where="root" />
            </CardContent>
          </Card>

          {selected && (
            <Card className="max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:max-h-[60dvh] max-md:overflow-y-auto max-md:rounded-b-none max-md:border-b-0 max-md:shadow-2xl">
              <CardHeader className="max-md:pt-5">
                <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-muted md:hidden" />
                <CardTitle className="flex items-center justify-between gap-2">
                  {t("editor.selected_element")}
                  <IconButton
                    icon="close"
                    label={t("common.close")}
                    variant="ghost"
                    className="md:hidden"
                    onClick={() => setSelection(null)}
                  />
                </CardTitle>
                <CardDescription>
                  {selectedParent
                    ? `${elementLabel(selectedParent)} — ${elementLabel(selected)}`
                    : elementLabel(selected)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    id="el-x"
                    label={t("editor.x_mm")}
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
                    label={t("editor.y_mm")}
                    value={selected.at.y_mm}
                    onChange={(v) =>
                      updateSelected((el) => ({
                        ...el,
                        at: { ...el.at, y_mm: v },
                      }))
                    }
                  />
                </div>
                {selectedParent && (
                  <span className="-mt-2 text-caption text-muted-foreground">
                    {t("editor.coords_relative")}
                  </span>
                )}

                {/* A frame decides which page its children appear on,
                    so a child in a frame cannot choose one. */}
                {selected.type !== "group" &&
                  selectedParent?.type !== "frame" && (
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
                      <Label>{t("editor.content")}</Label>
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
                        {t("editor.content_note", { field: "{{name}}" })}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <NumField
                        id="t-w"
                        label={t("editor.width_mm")}
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
                        label={t("editor.height_mm")}
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
                        label={t("editor.text_size_mm")}
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
                        <Label>{t("editor.align")}</Label>
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
                            <SelectItem value="left">
                              {t("editor.align_left")}
                            </SelectItem>
                            <SelectItem value="center">
                              {t("editor.align_center")}
                            </SelectItem>
                            <SelectItem value="right">
                              {t("editor.align_right")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex gap-5">
                      <SwitchRow
                        label={t("editor.bold")}
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
                        label={t("editor.italic")}
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
                        label={t("editor.length_mm")}
                        value={selected.length_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "line" ? { ...el, length_mm: v } : el,
                          )
                        }
                      />
                      <NumField
                        id="l-th"
                        label={t("editor.thickness_mm")}
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
                      label={t("editor.vertical")}
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
                        label={t("editor.width_mm")}
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
                        label={t("editor.height_mm")}
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
                      label={t("editor.filled")}
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
                          label={t("editor.width_mm")}
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
                          label={t("editor.height_mm")}
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
                          <Label>{t("editor.kind")}</Label>
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
                        label={t("editor.qr_size_mm")}
                        value={selected.h_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "qr" ? { ...el, h_mm: v } : el,
                          )
                        }
                      />
                    )}
                    <div className="flex flex-col gap-1">
                      <Label>{t("editor.value")}</Label>
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
                        label={t("editor.barcode_text")}
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
                        label={t("editor.width_mm")}
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
                        label={t("editor.height_mm")}
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
                      <Label>{t("editor.source")}</Label>
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

                {selected.type === "group" && selection && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <NumField
                        id="g-w"
                        label={t("editor.column_width_mm")}
                        value={selected.w_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "group" ? { ...el, w_mm: v } : el,
                          )
                        }
                      />
                      <NumField
                        id="g-gap"
                        label={t("editor.gap_mm")}
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
                      <Label>{t("editor.rows_from")}</Label>
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
                        {t("editor.rows_from_note")}
                      </span>
                    </div>
                    <AddElement
                      onAdd={(type) => addElement(selection.path, type)}
                      where="row"
                    />
                  </div>
                )}

                {selected.type === "frame" && selection && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-3 gap-3">
                      <NumField
                        id="f-w"
                        label={t("editor.width_mm")}
                        value={selected.size.w_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "frame"
                              ? { ...el, size: { ...el.size, w_mm: v } }
                              : el,
                          )
                        }
                      />
                      <NumField
                        id="f-h"
                        label={t("editor.height_mm")}
                        value={selected.size.h_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "frame"
                              ? { ...el, size: { ...el.size, h_mm: v } }
                              : el,
                          )
                        }
                      />
                      <NumField
                        id="f-border"
                        label={t("editor.border_mm")}
                        step={0.05}
                        value={selected.border_mm}
                        onChange={(v) =>
                          updateSelected((el) =>
                            el.type === "frame" ? { ...el, border_mm: v } : el,
                          )
                        }
                      />
                    </div>
                    <AddElement
                      onAdd={(type) => addElement(selection.path, type)}
                      where="frame"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {bindings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("editor.data_fields")}</CardTitle>
                <CardDescription>
                  {t("editor.data_fields_note")}
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
              <CardTitle>{t("editor.preview")}</CardTitle>
              <CardDescription>{t("editor.preview_note")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Select value={printer} onValueChange={setPrinter}>
                <SelectTrigger>
                  <SelectValue placeholder={t("editor.pick_printer")} />
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
                      {t("print.pages", { count: preview.pages })} ·{" "}
                      {preview.bytes} B
                    </span>
                  </div>
                  {preview.fallback && (
                    <div className="rounded-md bg-warning-soft px-3 py-2 text-body-sm text-warning">
                      {t("print.fallback", { path: preview.fallback })}
                    </div>
                  )}
                  {preview.preview && preview.preview.length > 0 && (
                    <JobPreview previews={preview.preview} />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The element tree: select and delete. A group's items sit indented
 *  under it; the draw order is the list order. */
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

/**
 * The canvas substitutes the bindings from the first sample record:
 * the first element of a parsed array, or a parsed object sample.
 * `null` when the sample is not a record the canvas can fill in.
 */
function firstRecordOf(sample: string): Record<string, unknown> | null {
  try {
    const arr: unknown = JSON.parse(sample);
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      typeof arr[0] === "object" &&
      arr[0] !== null
    ) {
      return arr[0] as Record<string, unknown>;
    }
    if (typeof arr === "object" && arr !== null) {
      return arr as Record<string, unknown>;
    }
  } catch {
    // not JSON — nothing to substitute from
  }
  return null;
}
