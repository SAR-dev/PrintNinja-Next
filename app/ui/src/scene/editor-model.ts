/**
 * Scene editor state helpers (plan phase 7, scene editor v1): defaults
 * for a new element, the selection (an element at the root, or inside a
 * repeating group), and the rule that the template's declared fields
 * follow the bindings its elements actually use.
 */
import {
  bindingNames,
  type Element,
  type Field,
  type Media,
  type Placement,
  type Template,
} from "./schema";

/** Where an element lives: at the page root, or inside group number n. */
export type Container = "root" | number;

export interface Selection {
  container: Container;
  index: number;
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

/** A short, human line for the element list. */
export function elementLabel(el: Element): string {
  switch (el.type) {
    case "text":
      return `Text — ${el.content}`;
    case "barcode":
      return `Barcode (${el.kind ?? "code128"}) — ${el.value}`;
    case "qr":
      return `QR — ${el.value}`;
    case "image":
      return `Image — ${el.src}`;
    case "line":
      return el.vertical ? "Line (vertical)" : "Line";
    case "rect":
      return el.fill ? "Rectangle (filled)" : "Rectangle";
    case "group":
      return `Group — one row per ${el.bind}`;
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

/** The elements living in a container (root, or group number). */
export function elementsOf(
  template: Template,
  container: Container,
): Element[] {
  if (container === "root") return template.elements;
  const el = template.elements[container];
  return el && el.type === "group" ? el.items : [];
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
