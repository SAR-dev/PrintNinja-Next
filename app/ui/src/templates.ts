/**
 * The templates the app knows: the starters it ships with (plan phase
 * 7: the first-run path is template → data → print, under a minute)
 * plus the ones the user edits or creates. Local template storage
 * (SQLite) lands in a later increment — until then the list lives in
 * memory.
 */
import type { Template } from "@/scene/schema";

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  /** Which track renders it: "scene" or "document" (html). */
  track: "scene" | "document";
  template: Template;
  /** The data field's starting records, as JSON text. */
  sample: string;
}

export const starters: AppTemplate[] = [
  {
    id: "parts-label",
    name: "Parts label",
    description: "A 40 × 50 mm label with a part name and a rule.",
    track: "scene",
    template: {
      format: "scene",
      media: { kind: "label", width_mm: 40, height_mm: 50 },
      fields: [{ name: "name" }],
      elements: [
        {
          type: "text",
          at: { x_mm: 2, y_mm: 2 },
          size: { w_mm: 36, h_mm: 4 },
          content: "{{name}}",
          style: { size_mm: 3 },
        },
        {
          type: "line",
          at: { x_mm: 2, y_mm: 7 },
          length_mm: 36,
          thickness_mm: 0.2,
        },
      ],
    },
    sample: '[{"name":"BOLT M8"},{"name":"NUT M8"}]',
  },
  {
    id: "a4-note",
    name: "A4 note",
    description: "An A4 page with a heading — one record per page.",
    track: "document",
    template: {
      format: "html",
      media: { kind: "page", width_mm: 210, height_mm: 297 },
      elements: [],
      html: `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 20mm; color: #1a1a1a; }
  h1 { font-size: 22pt; margin-bottom: 4mm; }
  p { font-size: 11pt; line-height: 1.6; }
</style>
</head>
<body>
  <h1>Note for {{to}}</h1>
  <p>This page was printed by PrintNinja.</p>
</body>
</html>`,
    },
    sample: '[{"to":"Rafi"},{"to":"Sara"}]',
  },
];
