# Label Designer — Live Barcode/QR and Nested Boxes

Repo: `SAR-dev/PrintNinja-Next`, branch `develop` (HEAD `6dbb6db`) · Scope: the scene editor (`app/ui/src/screens/editor-screen.tsx`, `app/ui/src/scene/*`) plus the `pn-scene` Rust crate · Status: **final, decisions confirmed (see §6). Plan only, no code changed.**

Decisions already made: schema changes are allowed; the two goals are (1) draw barcodes and QR codes live on the canvas and (2) allow nested designs — a box inside a box.

---

## 1. Where things stand today

| Area | Today | Source |
|---|---|---|
| Barcode / QR on the canvas | A dashed placeholder box with the text `barcode (code128)` or `qr`. Nothing is encoded. | `scene-canvas.tsx` → `Placeholder` |
| Bindings on the canvas | Text shows the raw template (`{{name}}`), never the sample data. | `scene-canvas.tsx` → `glyph` |
| Real output | The Rust renderer stamps the barcode/QR as 1-bit dots, with quiet zones (10 modules for 1-D, 4 for QR). The preview button runs the true print path. | `core/render/src/barcode.rs` |
| Why it matters | The repo rule (REFACTORING decision #13) is "preview and print must agree on what a symbol is". | `barcode.rs` header |
| Containers | `rect` is an outline or fill with **no children**. `group` is a *repeater* (one set of items per row of a list), items are relative to the group, and **groups may not nest** (`TemplateError::NestedGroups`). | `core/scene/src/lib.rs` |
| Selection model | `Container = "root" \| number` — exactly one level deep. | `editor-model.ts` |
| Layout pipeline | `expand()` turns template + records into pages of `Placed` elements (absolute mm). Encoders and the renderer only ever see `Placed`, never groups. | `core/scene/src/expand.rs` |

Two facts make both goals cheaper than they look:

1. The renderer already knows exactly how a barcode or QR is encoded; the canvas only needs those module patterns.
2. Everything downstream of `expand()` (renderer, ZPL/TSPL/CPCL/ESC-POS encoders, golden tests) works on flat absolute elements, so nesting can be solved **entirely at expand time**.

---

## 2. Goal A — Live barcode and QR drawing

### Options considered

| Option | Idea | Verdict |
|---|---|---|
| A1. JS libraries (e.g. bwip-js, qrcode) | Encode in the browser. | Fast to build, but two encoders can disagree with the printer (check-digit rules, ITF odd length, Code 128 subsets, QR version/EC level). Breaks decision #13. **Rejected.** |
| **A2. Ask Rust for the modules** | New Tauri command returns the module pattern from the same `barcoders` / `qrcode` code the printer uses. The canvas draws SVG `rect`s from it. | **Recommended.** One source of truth, tiny payloads, easy to test. |
| A3. Compile `pn-render` to WASM | Run the real renderer in the browser. | Heavy (`rxing`, fonts, PDF); large bundle; overkill. |

### Design (A2)

**Rust (`core/render/src/barcode.rs`)**
- Expose two pure functions next to the existing `barcode_module_count` / `qr_module_side`:
  - `barcode_modules(kind, value) -> Option<Vec<u8>>` (dark/light run pattern, quiet zone excluded)
  - `qr_matrix(value) -> Option<{ side, modules }>` (EC level M, as the renderer uses)
- Make `draw_barcode` / `draw_qr` call the same functions so the canvas and the print cannot diverge.
- New Tauri command `encode_symbol(kind, value) -> { quiet, modules, side? } | null` in `app/src/lib.rs`, registered with the other commands.

**UI**
- `api.ts`: `encodeSymbol()` wrapper plus a small cache keyed by `(kind, value)`, debounced ~150 ms so typing in the value field does not flood the bridge.
- `scene-canvas.tsx`: new `BarcodeGlyph` and `QrGlyph`:
  - bars span the element box width (with the same quiet-zone maths as `draw_barcode`), height minus the text band when `show_text` is on, human-readable text under the bars;
  - QR is a `<path>` of dark modules, square, in the element's `h_mm` box (4-module quiet zone).
- **Sample data on the canvas:** substitute `{{field}}` from the first sample record (`previewRecord(initial.sample)` already exists in the screen) for text, barcode and QR content. A toggle "Show sample data / Show fields" lets the user see `{{code}}` when they want the bindings.
- **Honest failure state:** when the value cannot be encoded (bad EAN-13 check digit, odd ITF length, empty value) the renderer draws nothing, so the canvas shows the dashed box with a short reason ("EAN-13 needs 12–13 digits"), not a fake symbol.
- Fit hint: if the symbol is wider than its box (module width below one printer dot at the profile dpi) show a small warning badge on the element.
- Image elements: draw the real image when `src` is a data URI; keep the placeholder for resource paths.
- `pnpm shots` runs against the fake bridge, so `e2e/support/fakeAgent/index.ts` needs an `encode_symbol` handler (a deterministic stub pattern).

**Tests**
- Rust unit tests: known Code 128 / EAN-13 / QR values give the expected module counts; invalid values return `None`; `draw_barcode` and `barcode_modules` agree (same dark-module count at a given width).
- A UI test for the quiet-zone/width maths (pure function, extracted from the glyph).

---

## 3. Goal B — Nested designs ("box inside box")

### What "nested" should mean

Two different things hide behind the phrase:

| Meaning | Example | In this plan |
|---|---|---|
| **Visual containment** | A bordered box that holds a title, a barcode and another bordered box, all moving together. | **Yes — new `frame` element.** |
| Nested *repeaters* | A repeating group inside a repeating group (rows with sub-rows). | **No (non-goal).** Flowing across page cuts makes this a separate, harder feature. The existing `NestedGroups` rule stays. |

### New element: `frame`

```jsonc
{
  "type": "frame",
  "at":   { "x_mm": 2, "y_mm": 2 },
  "size": { "w_mm": 36, "h_mm": 20 },
  "border_mm": 0.3,        // 0 = no border; outline only in v1 (use `rect` for a solid fill)
  "children": [ /* any fixed element, including another frame */ ],
  "page": "every"
}
```

- Children are positioned **relative to the frame's top-left**, exactly like group items are relative to the group.
- Frames nest to a depth limit (proposal: 4) to stop runaway documents.
- A frame is placed like any fixed element (`page: every | first | last | { only: n }`); its children's own `page` is ignored (the frame decides) and the validator rejects a conflicting value.
- A **frame may sit inside a group item** (a bordered invoice row is a common need). A **group may not sit inside a frame** in v1.
- Children must lie inside the frame's size (same `OffPage`-style check, relative to the frame); a `clip` option is a later extra.

### Why this is cheap and safe: flatten at expand time

`expand.rs` already turns groups into absolute `Placed` elements. A frame is flattened the same way:

1. Draw the frame's border as a `PlacedKind::Rect` (outline, `border_mm` thick; skipped when `border_mm` is 0).
2. Recurse into `children`, adding the frame's `at` to each child's position.

Result: **no change to the renderer or to any encoder**, no change to golden files for existing templates, and the preview/print path stays identical. `bindings()`, `height_mm()` and `width_mm()` get a `Frame` arm.

### Schema and compatibility

- Rust `Element::Frame { at, size, border_mm, children, page }` in `core/scene/src/lib.rs`; TS mirror in `schema.ts` (the file's own rule: field-for-field identical; the Rust golden round-trip test pins the wire format — extend it with a frame).
- New `TemplateError` variants: frame too deep, child outside frame, conflicting child `page`, group inside frame.
- **Compatibility (accepted):** old app versions fail to parse a template that contains `frame` (unknown enum variant), and the **registry server validates with the same `pn_scene::Template` type**, so a server on the old schema rejects publishing. Mitigation:
  - ship server and app together (same workspace, same release tag);
  - make the parse error readable ("This template needs a newer PrintNinja");
  - no version field in this release; revisit if the schema keeps growing.

### Editor changes for nesting

| Piece | Change |
|---|---|
| `Selection` | `Container = "root" \| number` becomes a **path**: `number[]` (`[]` = root, `[2]` = children of element 2, `[2,0]` = grandchildren). Helpers `getAt(path)`, `updateAt(path, fn)`, `insertAt`, `removeAt` replace the three near-duplicate code paths in `editor-screen.tsx` (`updateAt`, `addElement`, `deleteElement`). |
| Elements panel | A **tree** (indent, expand/collapse, icon per type). Selecting a row selects it on the canvas. |
| Canvas | Recursive `ElementNode` with `transform="translate(x y)"` per frame; hit-testing picks the deepest element under the pointer. Frames show their border plus a faint label when selected. |
| Dragging | Moving a frame moves its children (relative coordinates make this free). Dragging an element **into** a frame (drop target highlight) or **out** of it re-parents it and recomputes relative coordinates. |
| Add element | "Add" targets the currently selected frame (or root); a new `frame` option is added to `ELEMENT_TYPES`. |
| Properties | Frame: position, size, border thickness. Child coordinates are shown relative to the parent, with the parent's name in the panel header. |
| i18n | New keys in `en.ts` and `ja.ts` (both required). |

---

## 4. Work plan

Each step is independently reviewable and finishes with the repo's verification loop (`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `pnpm test:rust`, `pnpm --dir app/ui lint`, `pnpm --dir app/ui build`, a `CHANGELOG.md` bullet, `graphify update .`; one-line commits).

| Step | What | Size | Risk |
|---|---|---|---|
| 1 | **Selection paths refactor** (no behaviour change): `Container` → `number[]`, shared `getAt/updateAt/insertAt/removeAt` helpers, tree-aware element list. Existing groups keep working. | M | Low |
| 2 | **Live barcode/QR**: Rust `barcode_modules`/`qr_matrix`, `encode_symbol` command, fake-bridge stub, canvas glyphs, sample-data toggle, failure hints. | M | Low–Med |
| 3 | **`frame` in Rust**: enum variant, validation, `expand` flattening, unit tests (offsets, nesting, errors), golden case, round-trip test. | M | Med |
| 4 | **`frame` in the editor**: TS schema mirror, recursive canvas, tree panel, drag into/out of frames, properties, en/ja strings. | L | Med |
| 5 | **Undo/redo and resize handles** (follow-up on the tree/path model from steps 1 and 4): history stack with Ctrl/Cmd+Z / Shift+Z, resize handles on the selected element (corner and edge, 0.1 mm steps, respecting the frame's bounds), Delete and arrow-key nudge. | M | Low–Med |
| 6 | **Docs and polish**: `docs/FEATURES.md`, `docs/ARCHITECTURE.md` (scene format), `docs/GLOSSARY.md`, `docs/UI_GUIDE.md`; refresh screenshots (`pnpm shots`) in both languages and the phone viewport. | S | Low |

Order rationale: step 1 de-risks everything; steps 2 and 3 are independent and could be parallel; step 4 needs 1 and 3; step 5 needs 4 so history and resizing work on nested elements from day one.

---

## 5. Tests and acceptance

- **Rust:** frame flattening produces the expected absolute `Placed` list (including nested frames and a frame inside a group item across a page cut); validation errors for each new case; JSON round-trip; a golden-byte case with a framed label; `barcode_modules` agrees with `draw_barcode`.
- **UI:** path helpers (insert/remove/update at depth), quiet-zone maths, re-parenting recomputes coordinates, `pnpm shots` clean in en/ja × light/dark × desktop/phone.
- **Acceptance:** a user can build "a bordered box containing a title, a QR code and an inner bordered box with a barcode"; the canvas shows real symbols with sample data; pressing Preview shows the same symbols pixel-for-pixel at the printer's dpi; saving, publishing and reopening the template keeps the structure.

---

## 6. Decisions (confirmed)

1. **Compatibility:** app and registry server ship together; no version field now. Templates with `frame` give a readable "needs a newer PrintNinja" error on older clients.
2. **Frames are outline-only in v1.** Solid fills stay with `rect`; inverted (white-on-black) ink is a later renderer/encoder feature.
3. **Limits:** nesting depth 4, square corners, no clipping; children must stay inside the frame.
4. **Canvas extras:** undo/redo, resize handles, Delete and arrow-key nudge come right after the frame editor (step 5).
5. **Scope:** schema changes are allowed; repeating groups still cannot nest; document (HTML/CSS) track untouched.

## 7. Non-goals

Nested repeating groups; filled/inverted frames; rounded corners and clipping; rotation; non-1-D/QR symbologies (DataMatrix, PDF417); changing encoders or the renderer's drawing code beyond sharing the module functions; the document (HTML/CSS) track.
