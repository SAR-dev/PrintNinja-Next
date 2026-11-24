# PrintNinja-Next — UI Improvement Plan

Branch: `develop` (HEAD `b4a7f45`) · Scope: `app/ui` (React 18 + Tailwind 3 + Radix/shadcn-style components, i18n en/ja) · Basis: the 36 desktop screenshots (en/ja × light/dark × 9–12 screens) plus a read of `layout.tsx`, `page-header.tsx`, `index.css`, `App.tsx` and the four screen files.

> Status: **final, approved scope** (keep brand, all six phases, phone included). No code has been changed yet. The Android/phone screenshots were not in the zip, so phone-width findings come from the code (responsive classes) and must be confirmed with `pnpm shots`.

---

## 1. What is good and should stay

- A coherent "Slate teal" token system with light/dark pairs and contrast tests (`src/test/tokens.test.ts`). Keep the palette; refine how it is used.
- Status vocabulary always pairs colour + icon + word (`StatusBadge`).
- Skip link, `aria-current`, reduced-motion handling, density tokens.
- Collapsible sidebar and sticky page header are the right shell.

## 2. Findings from the screenshots

### A. Layout and alignment (highest impact)

| # | Finding | Where | Evidence |
|---|---------|-------|----------|
| A1 | **Page header and page body use different widths.** `PageHeader` is full-bleed (negative margins), while the body sits in a per-screen `max-w-*` container. On the list the title is at the far left while the cards are centred 200 px to the right; the tagline floats mid-row. On Settings the header divider is wider than the cards. | `page-header.tsx`, `App.tsx:672-686`, `settings-screen.tsx:188` | list, settings |
| A2 | **Five different content widths** (`3xl`, `5xl`, `6xl`, `6xl`, full 1600) so the left edge jumps between screens. | `App.tsx`, `print-screen.tsx:250`, `editor-screen.tsx:207`, `document-editor-screen.tsx:99` | all |
| A3 | Header description is centred between title and actions, which reads as stray text. | `page-header.tsx` | list, print |
| A4 | Print and editor screens are one long scroll; the right column (Preview/Result) is short and the left column carries everything, leaving a big empty right-hand area. | `print-screen.tsx` | print, print-done |

### B. Template list (home screen)

- B1 Title is the app name ("PrintNinja") repeated from the top bar; no useful page title ("Templates") and no counts.
- B2 Cards have no thumbnail or size info. The user cannot tell a 40×50 mm label from an A4 page without opening it. The data exists (width/height in the template).
- B3 Three equal-weight buttons per card (Publish / Edit / Print) plus a differently styled `Unpublish` text button. Row actions are not aligned between cards because `Unpublish` is narrower than `Publish`.
- B4 Tabs (Mine / Community / Saved) are a heavy grey bar the full content width, with a permanent thick focus ring on the active-looking tab after click (Community screenshot). No counts or icons.
- B5 "Recent jobs" duplicates the card pattern with smaller type and a mix of font sizes in one row. Result chip + "3 of 5" + Reprint are visually crowded on the right. This is the narrow-screen overlap CLAUDE.md already notes for Android.
- B6 Empty states are not shown in the screenshots; Community and Saved have no search/filter.

### C. Print screen

- C1 Preview and Print sit in a separate card from the inputs, so the user fills the left, then jumps right. The primary action is not near the data.
- C2 Preview and Print look nearly identical (filled vs pale). Print is enabled before a preview exists, with no hint.
- C3 Jargon: "Where the bytes go", "Result" card with a lone green bar. The result is a full-width coloured block with a single word; details (printer, time, retry) are missing.
- C4 The Data card is long; Data URL, Method, helper text and the JSON textarea all share one visual level. The textarea does not use the mono font.
- C5 The printer select shows `zpl · label, continuous` as a faint line; capability chips (`can confirm`) are tiny.

### D. Scene editor

- D1 Elements list shows rows with a plain-text `Delete`; no icons, no selected state, no reorder handle, though the order is the draw order.
- D2 The canvas shows a 40×50 label as a large pale page with the artwork pinned at the top; no rulers, zoom or fit control, no snap/grid hint.
- D3 "Add element…" is a select rather than an obvious toolbar of element types.
- D4 Name field spans the whole width above everything and competes with the page title. Header holds Save, Preview, badge and back link with unclear priority (Save is primary, but "← Templates" and the badge sit left of it at the same size).
- D5 No unsaved-changes indicator.

### E. Document editor

- E1 The HTML textarea is a plain textarea: no line numbers, no tab handling, fixed height.
- E2 Preview is the right column, which is good, but paper presets (A4, A5, Letter) sit far below at the bottom of a long left column.

### F. Settings

- F1 One card per setting, each with a long description, gives a very tall page for four toggles. Theme and language use two "button pairs" where one is filled and one outlined; that reads as primary/secondary actions, not as a selected state.
- F2 Switch rows repeat the label in both the card title and the switch label.
- F3 Header divider and body widths differ (see A1).

### G. Dialogs

- G1 New-template dialog: two full-width buttons with the format in the label only. No icon, no preview, no description of the difference between scene and document.
- G2 Publish dialog: the name field opens with all text selected (acceptable) but the Publish and Cancel buttons are left-aligned and Cancel is borderless, so the footer looks unfinished. Slug and Readme have no inline help or validation hint.
- G3 Overlay is very dark in dark theme; the dialog barely separates from the page (new-template, dark).

### H. Top bar and chrome

- H1 Top bar mixes five elements of different visual weight: status chip, handle in 12 px grey, outlined Sync, plain Sign out. The handle has no avatar and no menu; Sign out is one mis-click from Sync.
- H2 The "Online" chip colour is the same family as the primary button, which weakens its meaning as a status.
- H3 Sidebar has only two items and a lot of empty space; the active state is subtle in dark mode.

### I. Internationalisation and theming

- I1 Japanese labels are fine but button widths differ from English, so card action columns shift (list, ja-dark). Fix by giving action groups fixed min-widths or icon-only secondary actions.
- I2 Dark mode: surfaces are close in lightness (background / card / secondary), so cards and tabs lose definition; primary is a bright cyan that is much louder than the light theme's teal.
- I3 Tags (`scene`, `document`, `published`) use two unrelated styles (solid teal vs grey). In ja the same tags use different colours again.

## 3. Proposed direction

Keep the brand and tokens. Make the app feel like a calm desktop tool: **one content grid, one header, one action hierarchy, and visual previews instead of text lists.**

Design principles:

1. **One width, one header.** Content aligns to the header on every screen.
2. **One primary action per screen**, always top-right or at the end of the form; everything else is secondary or an icon.
3. **Show, don't describe.** Thumbnails, size chips and live previews.
4. **Plain words.** Replace internal jargon.
5. **Same layout in en/ja and light/dark.**

## 4. Work plan

Each phase is shippable on its own and ends with the house verification loop from `CLAUDE.md` (`pnpm --dir app/ui lint`, `pnpm --dir app/ui build`, `pnpm shots` review, CHANGELOG bullet, `graphify update .`).

### Phase 1 — Shell and tokens (fixes A1–A3, H, I2, I3)

- Move `PageHeader` into the shell's content grid so title, description and actions share the same left and right edges as the body; description goes under the title (left aligned), not centred.
- Introduce two shared width wrappers: `page-narrow` (list, settings, ≈ 48 rem) and `page-wide` (print, editors, ≈ 72 rem) so the left edge never jumps within a group; stop per-screen `mx-auto max-w-*`.
- Top bar: group registry status and account into one account menu (avatar/initial, handle, Sync, Sign out). Show a small status dot instead of a coloured chip.
- Dark theme: increase step between `--background`, `--card`, `--secondary`; tone down `--primary` saturation; lighten the dialog overlay slightly and add a 1 px ring to popovers.
- One `Tag` component (scene / document / published) with a single style set; `tokens.test.ts` extended for the new pairs.
- Sidebar: stronger active state (left accent bar), keep collapse.

### Phase 2 — Template list (B)

- Page title "Templates"; show counts on tabs (`Mine 3 · Community 2 · Saved 0`), make tabs a compact underlined segmented control, and remove the sticky focus ring (use `:focus-visible` only).
- Replace card rows with a **grid of template cards** (1 column narrow, 2–3 wide): live thumbnail (scene → mini canvas using the existing scene renderer; document → scaled iframe or first-record render), name, tag, `40 × 50 mm` size chip, description (2 lines), and a footer with **Print** (primary) and an overflow menu (Edit, Publish/Unpublish, Delete). Keep a list/grid toggle if rows are preferred.
- Search box and sort (recent / name) above the grid; useful once Community grows.
- Recent jobs: compact table (template · time · copies · printer · status · action) with a fixed status column, so the Android overlap disappears; collapse to stacked rows below `md`.
- Designed empty states for each tab (illustration/icon, one sentence, one action).

### Phase 3 — Print screen (C)

- Two-column layout becomes **form left, sticky summary right**: the right column shows the job summary (template thumbnail, printer, transport, record/page count) and holds **Preview** (secondary) and **Print** (primary) so they are always in view.
- Print is disabled with a visible reason (`Pick a printer`, `Add data`), and offers "Preview first" when none was run (non-blocking).
- Rename "Where the bytes go" to "Connection" / 「接続」 and keep the transport details in an accordion for non-default transports.
- Data: tabs `Paste · File · URL` instead of showing all three at once; JSON/CSV textarea in the mono font with record count and validation message underneath.
- Result card becomes a status banner with icon, the printer, time, "3 of 5 pages", and Retry/Reprint actions; auto-scroll into view on completion.

### Phase 4 — Editors (D, E)

- Scene editor: three regions — left **elements panel** (icon + name rows, selected state, drag reorder, delete icon with confirm via undo toast), centre **canvas** with zoom/fit, rulers in mm and a snap toggle, right **properties** for the selected element and the media settings in a collapsible section.
- Replace the "Add element…" select with a toolbar of icon buttons (Text, Line, Box, Image, Barcode — whichever the model supports).
- Header: inline editable name (replaces the full-width Name field), unsaved-changes dot, `Save` primary, `Preview` secondary, back as an icon-only button with tooltip.
- Document editor: mono editor with line numbers and soft tab handling (CodeMirror lite or a tuned textarea — decide in review; keep bundle impact in mind), paper presets moved next to the Paper card header, preview scale-to-fit.

### Phase 5 — Settings and dialogs (F, G)

- Settings: ~~group into sections with headings (Appearance, Startup & network, Printing)~~ — superseded: the screen is now five tabs (General, Printers, Network, Data, Registry), which also took in the saved printers and the per-printer pacing settings. Rows with label + control on one line and the description below; replace the button pairs with a segmented control (selected = filled, others plain).
- New-template dialog: two selectable cards with icon, title, one-line explanation and a tiny illustration; Enter confirms the highlighted one.
- Publish dialog: right-aligned footer, Cancel as a secondary button, slug helper text with live preview of the URL and inline validation.

### Phase 6 — Polish and QA

- Motion: 120–200 ms fades on dialogs, skeletons on list load, toast on save/publish (tokens already exist).
- Re-run the full screenshot matrix (en/ja × light/dark × desktop/phone) and check: no text clipping in ja, no overlap at 360 px, keyboard path through every screen, contrast tests green.
- Refresh the curated README images in `assets/` and update `docs/UI_GUIDE.md` (it still says "no sidebar" and describes the topbar-only navigation, which is out of date).
- ~~Remove `continue-on-error` from the `screenshot-matrix` job when all cases pass (per `docs/CI.md`)~~ — done: the matrix is all green and the job is blocking again.

## 5. Suggested order and size

| Phase | Effort | Risk | Why this order |
|-------|--------|------|----------------|
| 1 Shell + tokens | S–M | Low | Affects every screen; makes later phases cheaper |
| 2 Template list | M | Low–Med | Home screen, biggest visible change |
| 3 Print screen | M | Med | Core workflow; touches state logic in `print-screen.tsx` (538 lines) |
| 4 Editors | L | Med–High | `editor-screen.tsx` is 1042 lines; split into components first |
| 5 Settings + dialogs | S | Low | Mostly presentational |
| 6 Polish + QA | S | Low | Closing loop |

## 6. Constraints from the repo (will be followed)

- Commits: one-line messages, no body, no `Co-Authored-By` line.
- Per UI change: `pnpm --dir app/ui lint`, `pnpm --dir app/ui build`; add a bullet under *Unreleased* in `CHANGELOG.md`; run `graphify update .`.
- Prefer existing components in `components/ui/*`; new dependencies only where listed above and agreed.
- No new copy without both `en` and `ja` strings.
- `screenshots/` is gitignored; never commit it.

## 7. Decisions (confirmed)

1. **Direction:** keep the teal brand and IBM Plex Sans. Refine layout, hierarchy and dark-theme contrast; no rebrand.
2. **Scope:** all six phases, in the order above.
3. **Phone:** in scope. Every phase must work at 360 px (Pixel-7 viewport in `pnpm shots`); phase 2 fixes the known recent-jobs/footer overlap, and phase 6 re-blocks the `screenshot-matrix` CI job.

## 8. Remaining assumptions (to confirm while building)

- Template thumbnails can reuse the existing scene renderer / document preview path; if it needs the Rust side, phase 2 grows.
- The phase 4 element toolbar will expose only the element types the scene model supports today.
- Phone screenshots were not in the supplied zip; phone findings come from code and get confirmed with `pnpm shots` in phase 1.
