/**
 * Scene editor state helpers (plan phase 7, scene editor v1): defaults
 * for a new element, the selection (an element at the root, or inside a
 * repeating group), and the rule that the template's declared fields
 * follow the bindings its elements actually use.
 */
import i18n from "@/lib/i18n";
import {
  bindingNames,
  type Element,
  type Field,
  type Media,
  type Placement,
  type Template,
} from "./schema";

/**
 * Where an element lives: the path of indices from the root.
 * `[2]` is the third root element; `[2, 0]` the first item of the
 * group at `[2]`. A container is a path to the element holding the
 * children (`[]` = root, `[2]` = the group at index 2).
 */
export type Path = number[];

export interface Selection {
  path: Path;
}

/** What the user can add, in the order the list offers them. */
export const ELEMENT_TYPES = [
  "text",
  "line",
  "rect",
  "barcode",
  "qr",
  "image",
  "group",
] as const;

/** A blank label to start a new scene template from. */
export function blankTemplate(): Template {
  return {
    format: "scene",
    media: { kind: "label", width_mm: 40, height_mm: 50 },
    fields: [],
    elements: [],
  };
}

/** A sensible first version of each element type, for a 40 mm page. */
export function defaultElement(type: string): Element {
  switch (type) {
    case "line":
      return {
        type: "line",
        at: { x_mm: 2, y_mm: 8 },
        length_mm: 36,
        thickness_mm: 0.2,
      };
    case "rect":
      return {
        type: "rect",
        at: { x_mm: 2, y_mm: 12 },
        size: { w_mm: 16, h_mm: 8 },
      };
    case "barcode":
      return {
        type: "barcode",
        at: { x_mm: 2, y_mm: 30 },
        size: { w_mm: 30, h_mm: 10 },
        value: "{{code}}",
      };
    case "qr":
      return {
        type: "qr",
        at: { x_mm: 30, y_mm: 30 },
        h_mm: 10,
        value: "{{code}}",
      };
    case "image":
      return {
        type: "image",
        at: { x_mm: 2, y_mm: 12 },
        size: { w_mm: 16, h_mm: 16 },
        src: "logo.png",
      };
    case "group":
      return {
        type: "group",
        at: { x_mm: 2, y_mm: 2 },
        w_mm: 36,
        item_gap_mm: 1,
        bind: "rows",
        page: "flow",
        items: [
          {
            type: "text",
            at: { x_mm: 0, y_mm: 0 },
            size: { w_mm: 34, h_mm: 4 },
            content: "{{item}}",
            style: { size_mm: 3 },
          },
        ],
      };
    default:
      return {
        type: "text",
        at: { x_mm: 2, y_mm: 2 },
        size: { w_mm: 30, h_mm: 4 },
        content: "Text",
        style: { size_mm: 3 },
      };
  }
}

/** A short, human line for the element list, in the UI language. */
export function elementLabel(el: Element): string {
  switch (el.type) {
    case "text":
      return i18n.t("editor.el_text", { content: el.content });
    case "barcode":
      return i18n.t("editor.el_barcode", {
        kind: el.kind ?? "code128",
        value: el.value,
      });
    case "qr":
      return i18n.t("editor.el_qr", { value: el.value });
    case "image":
      return i18n.t("editor.el_image", { src: el.src });
    case "line":
      return el.vertical
        ? i18n.t("editor.el_line_vertical")
        : i18n.t("editor.el_line");
    case "rect":
      return el.fill
        ? i18n.t("editor.el_rect_filled")
        : i18n.t("editor.el_rect");
    case "group":
      return i18n.t("editor.el_group", { bind: el.bind });
  }
}

/** Every `{{name}}` the template uses, in order of first use. */
export function allBindings(template: Template): string[] {
  const names: string[] = [];
  const add = (s: string) => {
    for (const n of bindingNames(s)) if (!names.includes(n)) names.push(n);
  };
  const walk = (els: Element[]) => {
    for (const el of els) {
      if (el.type === "text") add(el.content);
      else if (el.type === "barcode" || el.type === "qr") add(el.value);
      else if (el.type === "group") {
        if (!names.includes(el.bind)) names.push(el.bind);
        walk(el.items);
      }
    }
  };
  walk(template.elements);
  return names;
}

/** The template with its declared fields synced to the bindings in use. */
export function withSyncedFields(template: Template): Template {
  return {
    ...template,
    fields: allBindings(template).map((name): Field => ({ name })),
  };
}

/** Page dimensions in mm for any media kind. */
export function pageDims(media: Media): { w: number; h: number } {
  return {
    w: media.width_mm,
    h: media.kind === "roll" ? media.label_height_mm : media.height_mm,
  };
}

/** Whether two paths point at the same place. */
export function samePath(a: Path, b: Path): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** The element at a path, if the template has one there. */
export function getAt(template: Template, path: Path): Element | undefined {
  let els: Element[] = template.elements;
  let node: Element | undefined;
  for (const i of path) {
    node = els[i];
    if (!node) return undefined;
    els = node.type === "group" ? node.items : [];
  }
  return node;
}

/** The elements living in a container (root, or the group at a path). */
export function elementsOf(template: Template, container: Path): Element[] {
  if (container.length === 0) return template.elements;
  const el = getAt(template, container);
  return el && el.type === "group" ? el.items : [];
}

/** Run `fn` on the children of the container at a path ([] = root). */
function withChildren(
  template: Template,
  container: Path,
  fn: (els: Element[]) => Element[],
): Template {
  const rewrite = (els: Element[], rest: Path): Element[] => {
    if (rest.length === 0) return fn(els);
    const [i, ...deeper] = rest;
    return els.map((el, j) =>
      j === i && el.type === "group"
        ? { ...el, items: rewrite(el.items, deeper) }
        : el,
    );
  };
  return { ...template, elements: rewrite(template.elements, container) };
}

/** Rewrite the element at a path, leaving everything else as is. */
export function updateAt(
  template: Template,
  path: Path,
  fn: (el: Element) => Element,
): Template {
  const container = path.slice(0, -1);
  const index = path[path.length - 1];
  return withChildren(template, container, (els) =>
    els.map((el, i) => (i === index ? fn(el) : el)),
  );
}

/** Insert an element; the path is the spot it takes after the insert. */
export function insertAt(
  template: Template,
  path: Path,
  el: Element,
): Template {
  const container = path.slice(0, -1);
  const index = path[path.length - 1];
  return withChildren(template, container, (els) => {
    const next = els.slice();
    next.splice(index, 0, el);
    return next;
  });
}

/** Remove the element at a path. */
export function removeAt(template: Template, path: Path): Template {
  const container = path.slice(0, -1);
  const index = path[path.length - 1];
  return withChildren(template, container, (els) =>
    els.filter((_, i) => i !== index),
  );
}

/** A placement rendered in words. */
export function placementWord(p: Placement): string {
  return typeof p === "object" ? `only page ${p.only}` : p;
}

/** How tall one group row is, in mm — an estimate for the canvas. */
export function rowHeightMm(item: Element): number {
  switch (item.type) {
    case "text":
      return item.size.h_mm;
    case "barcode":
    case "image":
    case "rect":
      return item.size.h_mm;
    case "qr":
      return item.h_mm;
    case "line":
      return item.vertical ? item.length_mm : item.thickness_mm;
    case "group":
      return 4;
  }
}
