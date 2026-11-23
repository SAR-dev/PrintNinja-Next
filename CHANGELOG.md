# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/)
from the first release (phase 7). Until then, entries accumulate under
Unreleased.

## Unreleased

### Added

- Phase 0 skeleton: Rust workspace (`core/{scene,render,planner,profiles,encoders,transport,job}`, `app`, `tests/golden`)
- CI: web-check, rust-lint, rust-test-linux (Docker container), rust-test-windows
- Golden-file test harness with a placeholder case; `GOLDEN_UPDATE=1` regeneration
- Virtual printer fixture (Raw/IPP/LPD/HTTP, fault states) ported with smoke tests
- Design system port in `app/ui` (tokens, ui component set, fonts)
- Phase 2 printer profiles: `pn-profiles` crate — one TOML per model, cross-field
  validation (width consistency, quirk evidence), field-by-field user overrides
  (deep merge, arrays replaced), per-profile hardware checklist generation
- 11 shipped profiles mined from the current app: GK420d, ZT411, ZD421,
  TTP-244 Pro, CT-S500, TM-T88VII, QL-820NWB, Generic Thermal 58mm, RP325,
  Office Laser (CUPS), B-FP2D (on-hand device) — all `untested` until
  hardware-verified
- Phase 3 delivery (network increment): raw TCP / JetDirect transport with
  profile-driven pacing, send deadline and close delay; job runner with
  honest job results (confirmed, sent-unconfirmed, partial "N of M printed"
  with the reason, failed), preflight and mid-batch status checks, a single
  retry that is only attempted before any byte was flushed, and a
  per-printer serial job queue
- Delivery e2e suite against the virtual printer: a job is confirmed and
  its bytes verified on disk, a job without a status dialect ends
  unconfirmed, a dropped connection fails the job, a silent printer hits
  the send deadline mid-unit, a paper-out mid-batch reports "1 of 2
  printed" with a paper reason, and back-to-back jobs on one printer are
  serialized
- Phase 3 delivery (Windows spooler increment): a spooler transport for
  page printers and every queue installed in Windows (OpenPrinter →
  StartDoc/Write/EndDoc per unit, full-write verification, retryable
  connect), plus the pure datatype-choice and queue-status helpers
  (PDF-vs-RAW, the 1804 "invalid data type" refusal read as plain words,
  and the PRINTER_INFO_2 fault bits with their priority order) — unit
  tested on every platform
- Phase 3 delivery (CUPS/IPP increment): an IPP transport for page
  printers (CUPS, or a printer's own IPP interface) — one Print-Job per
  unit over plain HTTP, the reply checked for honesty (operation status
  and the reported job-state), plus the pure IPP request builders and
  response parsers and the CUPS queue helpers (queue listing, base-URL
  resolution, queue health, and the blocking-reason vocabulary read as
  plain words) — unit tested on every platform. `ipps://`/`https://`
  endpoints are a documented follow-up: TLS is not in the zero-dep
  transport yet
- Delivery e2e against the virtual printer's IPP endpoint: a page job is
  sent and its bytes verified on disk, and a printer that cannot print
  fails the job with the reason in plain words
- Phase 3 delivery (Bluetooth RFCOMM increment): a Bluetooth transport —
  Linux dials the paired device's RFCOMM socket directly (non-blocking,
  deadlines of its own; a wedged link cannot outlive them), Windows
  writes to the device's own SPP COM port (`COM7` named directly, or a
  MAC whose port is looked up in the device enumeration), and both read
  the status reply on the same byte stream. The address parser (MAC with
  an optional RFCOMM channel 1–30, or `COM{n}`) is shared and tested on
  every platform; real-hardware verification lands in phase 10
- Phase 4 scene format (schema increment): `pn-scene` — the single
  template language for the `scene` track (plan §5.1). One JSON document
  describes the media (fixed-size label, continuous roll, or page paper,
  in millimetres) and its elements — text, image, barcode, QR, line,
  rectangle, and repeating groups bound to a data array — with
  `{{binding}}`s, a per-element placement (`every`, `first`, `last`,
  `only n`, or `flow` for groups), and an optional declared field list
  that catches a mistyped binding before a job is queued. The template's
  `format` field picks the track: `scene` (default, every media) or
  `html` (`page` media only — rejected on thermal). Validation reports
  the problem in plain words; serialization is deterministic and its
  bytes are pinned by a golden case, mirrored field-for-field in
  TypeScript (`app/ui/src/scene/schema.ts`)
- Phase 4 scene format (data model and expansion increment): records —
  JSON (an array of objects; numbers and booleans coerce to text, an
  array of objects becomes a row list for group bindings) or CSV (RFC
  4180: header row, quoted fields, short rows pad, long rows are an
  error) — and `expand()`: one record expands to one output, a label
  output is exactly one page, a roll or page output is a strip cut at
  the page height with repeating groups flowing down it (an item that
  would cross a cut moves to the next cut, `last`-placed elements
  reserve the bottom region of every page), and an overflow — a full
  label, a row taller than a page — fails the job naming the record
  and the field instead of silently dropping rows. The expanded job
  (pages of placed elements with bindings resolved, in template order)
  is what every delivery adapter will take; its bytes are pinned by
  golden cases for a batch of labels, an N-page document, and a
  variable-length receipt
- Phase 5 raster renderer (page model increment): `pn-render` — the
  in-process renderer's first piece: a 1-bit page packed the way the
  thermal raster commands expect (eight dots per byte, MSB first),
  millimetres-to-dots geometry at the printer's dpi (both ends of a
  shape converted before it is clipped, so a shape that runs off the
  page keeps its scene-specified size), the physical head width as the
  cap on the raster (replacing the old app's ESC/POS receipt-width
  special cases with the profile's `head_width_dots`), and line and
  rectangle drawing (filled or framed, clipped to the page). The
  rendered bytes are pinned by a golden case; text, barcodes and PDF
  output join in later increments
- Phase 5 raster renderer (text increment): text shaping in `pn-render`
  — OpenType layout (swash) and outline rasterization (ab_glyph) over
  two embedded OFL variable fonts (Noto Sans, Noto Sans JP), with
  per-character fallback: a character the primary family does not carry
  (`.notdef`) is re-shaped in the next embedded font, so Japanese
  renders on the default family. Left/center/right alignment, faux bold
  (a second strike offset by 5% of the size) and a 12° faux italic,
  antialiased coverage thresholded at half a dot, clipped to the text's
  box and the page. Label and Japanese-line outputs are pinned by
  golden cases; an unknown font family falls back to the default rather
  than failing the print
- Phase 5 raster renderer (barcode increment): barcode and QR symbols in
  `pn-render` — the same encoders the old app's print renderer used
  (Code 128, Code 39, Code 93, EAN-13, UPC-A, ITF, and QR at error
  correction M), so preview and print agree on what a symbol is. The
  module pattern is scaled to the element's box with the quiet zone
  included (10 modules each side for linear codes, 4 for QR), and a
  `show_text` band under the bars carries the value in centered text. A
  value a symbology cannot carry — a wrong EAN check digit, an odd ITF
  length, non-ASCII Code 128 — draws nothing rather than failing the
  job. Every symbology is proven scannable: the rendered page is
  decoded back to the value by a multi-format reader (rxing,
  test-only), and the Code 128 label and the QR code are pinned by
  golden cases
- Phase 5 raster renderer (PDF output increment): PDF output for `page`
  media in `pn-render` (plan §5.2) — the same rendered dots the thermal
  path prints, wrapped in a document the OS print path can send to a
  page printer (spooler or IPP), so one renderer drives both. The PDF
  is a container, not a second renderer: each page is its own 1-bit
  bitmap, Flate-compressed and stretched by its content stream to the
  physical page size (mm → pt). Multi-page documents keep their page
  order in the page tree. The bytes are deterministic — a fixed
  compression level, no timestamps, stable object numbering — so the
  Code 128 label as a one-page PDF and a two-page A4 document (bold
  heading, a Japanese line, a QR) are pinned by golden cases, and the
  cross-reference table is checked to point at its own objects
- Phase 5 raster renderer (encoder increment): `pn-encoders` — the
  `raster()` entry point that wraps the rendered pages in the
  profile's language (plan §5.5), one entry point, dispatched on the
  profile's `language`. The four thermal wrappers are byte-for-byte
  ports of the old app's default output: ESC/POS as banded `GS v 0`
  commands (at most 256 rows per band — cheap Bluetooth heads drop
  oversized commands — with the blank bottom rows trimmed off, keeping
  at least one, so a test page on an A4-tall canvas does not feed 30 cm
  of nothing), ZPL and CPCL with the raster hex-encoded in a single
  `^GFA`/`EG` graphic, and TSPL with raw binary dots and the gap in
  millimetres derived from the profile's `min_gap_dots` (0.0 for
  continuous media). A document printer (`language = "pdf"`) has no
  raster path — its bytes are the PDF — so `raster()` reports that in
  plain words instead of guessing. A receipt, a Code 128 label, a
  framed label and a QR label on four shipped profiles are pinned by
  golden cases; the native (printer-side fonts and barcodes) encoders
  join in phase 6
- Phase 5 raster renderer (planner increment): `pn-planner` — the
  output-path decision for a job (plan §5.3). Track routing first: the
  template's `format` and media kind pick the track — `html` documents
  go through the headless browser track, a `scene` on `page` media is
  rendered to PDF in the Rust renderer for the OS print path, and a
  `scene` on label or roll media is rastered in the profile's thermal
  language (the native command path, preferred over raster when the
  scene fits, joins in phase 6). The printer's media must take the
  template's media or the plan fails in plain words; a thermal scene on
  a pdf-language printer falls back to the PDF path with the reason
  recorded, the way §5.3 asks for every fallback
- Phase 5 end-to-end (raster track): the whole §5 pipeline against the
  virtual printer — a scene template and its data records expand to one
  page per label, the planner picks the raster path, each page is painted
  onto the renderer at the profile's dpi (the raster capped to the head
  width), the rendered dots are wrapped in the printer's language (ZPL's
  `^GFA` graphic) and the job is delivered over raw TCP, ending
  `Confirmed` with the saved job byte-verified against the exact units
  the pipeline produced. The scene → render bridge (`paint_page`) is the
  one both the production pipeline and the preview draw through, so
  preview and print show the same dots
- Phase 5 document track (schema and renderer increments): the html
  document track's missing piece — the template's `html` field (plan
  §5.3). `format: html` now carries the document itself: validation
  requires it (and only it — an html template with scene elements, or a
  scene template with HTML content, is rejected in plain words),
  bindings in the document are checked against the declared fields like
  scene bindings, and `substitute()` fills one record's values into the
  document (a missing field becomes empty text; anything that is not a
  binding — the same rule `binding_names` applies — stays exactly as
  written). The field is mirrored in TypeScript, and a scene template
  without it serializes to exactly the old bytes. `pn-browser` renders
  the filled document to a PDF with the desktop OS's own headless
  browser in one shot (Edge on Windows, Chromium/Chrome on Linux, a
  `PRINTNINJA_BROWSER` override, a 60 s deadline, stderr to a file so a
  chatty browser can never hang the render) — and when no browser is
  found, or none comes out, the failure says so in plain words with the
  browser's own stderr excerpt, never a placeholder PDF. An e2e runs
  the whole track against the virtual printer: html template → one
  record substituted → browser PDF → IPP delivery, byte-verified on
  disk; where the machine has no browser (the CI container) it verifies
  the honest no-browser error instead
- Phase 6 native command path (encoder increment): `native()` per
  thermal language in `pn-encoders` (plan §5.5) — the scene in the
  printer's own commands instead of an image: text in the printer's
  built-in fonts (ZPL `^FD`, TSPL `TEXT` in the base font, CPCL `TEXT`,
  ESC/POS with alignment, size and bold), printer-generated barcodes
  (ZPL `^BC`/`^BQ`, TSPL `BARCODE`, ESC/POS `GS k` with a fixed
  model-2 `GS ( k` QR sequence), and `^GB`/`^GR`, `BAR`/`BOX`, `F`/`B`,
  or plain rules for lines and boxes. One refusal — a style the
  language has no native for (bold, italic), text outside the profile's
  code pages, an image, a barcode the profile does not list, or a
  profile with no native fonts — sends the whole job to raster, with a
  reason that names the blocking element in plain words; ESC/POS adds
  one layout rule (elements must not share a y-range, because the
  printer draws top to bottom in one column). The native bytes for a
  ZPL label, a TSPL label, a CPCL label and an ESC/POS receipt are
  pinned by golden cases, and a simple label prints native in under a
  tenth of the raster byte count
- Phase 6 native command path (planner increment): the planner now
  selects across all three paths (plan §5.3) — a scene on label or
  roll media first tries the native path, and when the scene outgrows
  the printer's language it takes the raster path with the refusal
  reason recorded in the plan, the way every fallback is recorded.
  Document media on driver-equipped printers keeps defaulting to the
  OS print path
- Phase 6 native command path (end-to-end): the native track against
  the virtual printer — a scene the printer's language can draw plans
  to native with no fallback, encodes to the printer's own commands
  (no raster graphic anywhere, the data bindings on the wire), and is
  delivered over raw TCP ending `Confirmed` with the saved job
  byte-verified; the raster e2e now plans through the same decision
  and shows the recorded fallback (a bold heading on a printer whose
  native fonts are plain falls back to raster, and the plan says why)
- Phase 7 app↔core pipeline: `app` gains a plain-Rust print pipeline
  (`prepare_units`, `print_units`, the transport factories for
  TCP/IPP/spooler/Bluetooth chosen at runtime) that drives the whole
  §5 path — plan, encode, pace, deliver — from the app side, with the
  preview rendered by the same path as the print (plan §3.4): scene
  jobs preview as a 1-bit bitmap at the profile's dpi, document jobs
  as the actual PDF. Tauri commands `list_printers`, `plan_job` and
  `print_job` expose it to the UI off the main thread; a fake TCP
  printer answers the status dialect, so a job ends `Confirmed`, a
  paper fault fails in the printer's own words, and a refused port
  says connect
- Phase 7 UI (print flow increment): the template list (starter
  templates with their track badge — scene or document) and the print
  screen: pick the printer from the profile set, choose where the
  bytes go (raw port, IPP, spooler, Bluetooth), enter the records,
  preview (output path, the recorded fallback, records/pages/units/
  bytes, and the dots or the PDF), print, and see the result in the
  plan's own vocabulary — confirmed, sent-not-confirmed, partially
  printed with the counts, failed with the reason, or wrong mode
  suspected
- Phase 7 UI (scene editor v1): scene templates are editable — the
  page is drawn as a canvas where elements are clicked to select and
  dragged to move (0.1 mm steps), with the element list to add or
  delete text, lines, rectangles, barcodes, QR, images, and repeating
  groups bound to a list field; the selected element's properties
  (position, size, content with `{{bindings}}`, text size/bold/
  italic/align, barcode kind, value, fill, page placement, group
  column width, row gap and binding); media settings (label, roll, or
  page dimensions in mm); and the declared data fields follow the
  bindings the elements actually use. The editor previews one record
  on the chosen printer with the same path as the print, "new
  template" chooses the track (the HTML/CSS document editor is the
  next increment), and the scene rows in the list gain an Edit button
