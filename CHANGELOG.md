# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/)
from the first release (phase 7). Until then, entries accumulate under
Unreleased.

## Unreleased

### Added

- Phase 0 skeleton: Rust workspace (`core/{scene,render,planner,profiles,encoders,transport,job}`, `app`, `tests/golden`)
- CI: web-check, rust-lint, rust-test-linux (Docker container), rust-test-windows,
  chromium-render (the document track through a real system Chrome), and rust-check
  (a gate job that passes only when every Rust job passed)
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
  template" chooses the track, and the scene rows in the list gain an
  Edit button
- Phase 7 UI (HTML/CSS document editor v1): document templates are
  editable too — the document's code, the paper size (with A4/A5/Letter
  presets), and the sample data, with a live browser preview that shows
  the first record substituted the way the print does it; the bindings
  in the document are listed, "new template" now offers both tracks,
  and the document rows in the list get an Edit button. The richer CSS
  designer toolbar is post-v1
- Phase 7 UI (data input and expanded preview increment): the print
  screen's data field now takes CSV as well as JSON (a header row and
  its rows, the same RFC 4180 rules the core has always parsed), and a
  "load from file" button reads a local JSON or CSV file into the field
  as text, so it stays inspectable and editable; the job commands parse
  the data as JSON first and then CSV, and name the data as neither
  when both readings fail. The preview now expands to every page: a
  scene job lists all its pages in order (a thumbnail grid when there
  is more than one), a document job shows the PDF(s) the printer will
  receive — one per record on the browser path, the whole document on
  the pdf path — and the editor's one-record preview shows every page
  of that record
- Phase 7 UI (recent jobs increment): every job the user prints —
  success, failure or partial — is remembered with the template content
  as it was at print time, the data, the copies and the transport, and
  the template list gains a "recent jobs" section (newest first, the
  last ten) that shows each job's time, copies and profile with its
  result in the plan's own vocabulary — including the "N of M" counts
  for a partial batch. A reprint re-runs the exact same job (the frozen
  template, even if it is edited later), a failed or wrong-mode job gets
  a retry instead, and the row shows the new result and time when it
  finishes
- Phase 7 app (persistence increment): the local store — one SQLite
  file in the app's data directory, created and self-describing on
  open — now keeps the templates (a saved row overrides its starter or
  is added as a user template), the recent jobs (the same ten the list
  shows, newest first, a reprint refreshes its result in place) and the
  settings (key and value, ready for the settings increment). The app
  still runs when the store cannot open: the commands say so, the list
  keeps its in-memory copies, and the footer names the failure in plain
  words instead of losing the edit silently
- Phase 7 app (settings increment): a settings screen, reached from the
  list, with the app's appearance (light or dark, remembered on the
  next start), start-with-computer (the OS autostart entry, on or off),
  and one card per printer with its pacing — chunk size, the pause
  between chunks, and the close delay. A field left empty uses the
  value the profile ships with, shown as the placeholder; the override
  is saved to the settings store and applied to the profile per job, so
  the shipped profiles are never touched and a broken saved row can
  never fail a print. The app now lives in the tray: the window's
  close button hides it, a tray icon (left-click to bring it back) and
  its menu hold the way back and the way out
- Phase 8 local print API (local increment): the same job pipeline the
  UI drives, over HTTP on `127.0.0.1:17717` — local by default, nothing
  off this PC can reach it. `GET /v1/health`, `GET /v1/printers` and
  `GET /v1/templates` read the app's own state; `POST /v1/print`
  accepts a saved template by name, a printer, the data (JSON or CSV
  text), the copies, and a transport (or the saved default for the
  printer, the setting `transport.<model>`), queues the job at once and
  answers 201 with the job's id. The job then runs the same pipeline —
  prepare, deliver, status — and `GET /v1/jobs` and `GET /v1/jobs/{id}`
  say where it stands and what it came out to; `DELETE /v1/jobs/{id}`
  cancels a job that has not started, `POST /v1/jobs/{id}/retry`
  re-runs a finished one. A retried request with the same
  `Idempotency-Key` header comes back the same job — 409, the original
  id, nothing new printed
- Phase 8 local print API (LAN increment): an opt-in switch in
  Settings ("Let other devices print to this PC", the setting
  `api.lan`, off by default) — on, the listener binds the whole
  network instead of `127.0.0.1`, from the next start, and a request
  from off this PC must carry its paired device's token in the
  `X-PrintNinja-Device-Token` header. Pairing: the PC opens a
  short-lived window with a one-time 8-character code (90 seconds,
  single use, five wrong codes lock it) shown on the Network card, a
  device presents the code to `POST /v1/pair/claim` and receives its
  token — shown once, the PC stores only its SHA-256; `GET
  /v1/pair/hello` tells a device whether this PC is a PrintNinja and
  whether a window is open. The paired-devices list on the same card
  names each device (name, platform, date) and can revoke it — the
  token stops working at once
- Phase 8 local print API (deep link increment): `printninja://print?…`
  links from a web page, a message or the shell reach the app cold or
  warm — the template by name, an optional printer profile and copy
  count prefill the print screen and stop there. The screen is the
  confirmation the plan promises for untrusted sources: a link carries
  no identity, so pressing Print is the confirmation for every source.
  A link with no template, a template this app does not have, or a
  link that cannot be read says so in plain words instead of doing
  nothing; the cold-start read and the warm-start event can race the
  same link, and it is dispatched once
- Phase 9 registry server (accounts increment): `pn-server`, a Rust
  axum service — the community registry the app will publish to.
  Accounts are keyed by a handle, not an email (1–32 of A-Z a-z 0-9 _
  -, matched case-insensitively, kept as typed): `POST /v1/account`
  creates one and signs the user in at once, `POST /v1/login` signs in
  and issues a session, `GET /v1/me` and `GET /v1/health` read state,
  `POST /v1/logout` ends a session, `POST /v1/password/change` swaps
  the password (keeping this session, ending every other one) and
  `POST /v1/handle` renames the account (a case-only rename is free; a
  real rename that lands on a taken handle is 409). Passwords are
  argon2id at the old server's parameters, and only the SHA-256 of a
  session token is stored — a leaked database leaks no live sessions;
  logins prune each account to its newest 20 sessions. The store is
  plain portable SQLite on a local file, so the production backend can
  be Turso (cloud SQLite) without the SQL changing
- Phase 9 registry server (publishing increment): the community
  gallery. `POST /v1/templates` publishes a template — checked with
  the same `pn_scene` parser and validation the app runs, so the
  registry never renders or prints and everything it accepts is
  something the app can open — with a name, a per-account slug
  (1–64 of a-z 0-9 -, unique per account, not globally) and an
  optional sample of starting records; `GET /v1/templates` browses
  the gallery with a search over name, readme and owner plus a track
  filter and paging, newest first, no sign-in needed to look around;
  `GET /v1/templates/{owner}/{slug}` (case-insensitive on the owner)
  returns the full document and sample, everything an app needs to
  save it as a local copy; `DELETE` unpublishes — owner only, and an
  unknown slug or someone else's template is the same 404, so the
  endpoint does not say which slugs other accounts have, even when
  they share a slug with the caller
- Phase 9 registry server (saving increment): a per-account saved
  list. `POST /v1/templates/{owner}/{slug}/save` pins a published
  template to the caller's list (idempotent — saving twice changes
  nothing), `DELETE` on the same path takes it off, and `GET
  /v1/saved` lists the caller's saves, newest save first, with the
  full documents and sample, so an app can open each one as an
  editable local copy and print it offline; when the owner
  unpublishes, the saves that point at it go with the row
- Phase 9 registry server (sync increment): offline-first sync of
  local changes. Publishing the same slug on the same account is now
  an update (200 with `created: false`) instead of a conflict — the
  endpoint an app replays through to push the edits it made offline —
  and `GET /v1/changes?since=&limit=` serves the change feed: every
  publish, update and unpublish, each with a strictly increasing seq
  the client uses as its cursor, in the order it happened, no
  sign-in needed. Live entries carry the full documents; an
  unpublish is a tombstone (`deleted: true`, documents gone, the
  owner and slug kept) so a client drops the local copy it made from
  it; a replayed unpublish appends no second tombstone
- Phase 9 registry (client increment): the sync engine in the app —
  the registry's change feed pulled into a local mirror (the
  Community list works offline, showing what the last sync saw), the
  signed-in account's session kept in the store, an offline queue
  that replays publishes, unpublishes, saves and unsaves when the
  connection returns, and a status probe: online, who is signed in,
  how many operations are waiting. The server address is the
  `registry.url` setting (shown and editable in Settings) over the
  `PN_REGISTRY_URL` environment variable, over the local default
- Phase 9 registry (UI increment): the template list grows
  Community and Saved tabs beside Mine; a sign-in dialog (handle and
  password, no email) that creates the account when new; a publish
  flow from any template (name, an optional slug drafted from the
  name, a readme); Publish and Unpublish buttons on local templates
  with a "published" badge; Save/Unsave on community rows that
  materialize an editable local copy; and a registry status chip —
  online, the handle, and the waiting count — with a Sync button
- Phase 9 registry (database increment): terminal database commands
  for `pn-server`, the way the old code did it from the shell —
  `pn-server migrate make <name>` writes the next numbered
  `NNNN_name.sql` file (plain portable SQLite, one transaction per
  file), `migrate apply` runs every file not applied yet,
  `migrate status` shows which are applied and which are waiting,
  and `db reset` deletes the database and rebuilds it from every
  migration in order. Applied files are recorded in
  `schema_migrations`; a failed migration rolls back only itself.
  `serve` applies whatever is pending before the first request, and
  a fresh database self-initializes from the first migration, which
  is embedded at compile time
- Phase 9 registry (deployable package increment): the registry is
  hostable on its own, the way the old code shipped — a Docker image
  (`server/Dockerfile`, `docker build -f server/Dockerfile .`) with
  the binary and its migrations baked in, the database on a `/data`
  volume, and the terminal commands reachable through
  `docker exec`. Any shared registry URL works (the app's registry
  setting). CI gained the old repo's server jobs: `server-check`
  (fmt/clippy/tests for `pn-server`, now part of the rust-check
  gate), `server-image` (the Docker image builds), `server-e2e`
  (the image through the full HTTP lifecycle — account, login,
  publish, gallery, fetch, save, change feed with tombstone,
  unpublish, logout — via `server/e2e.py`, stdlib-only python3), and
  `server-publish` (pushes the image to GHCR tagged by commit sha and
  `latest` on every push to main)
- User documentation: the README rewritten as a user guide (what it
  is, how a print works, the printers and their transports, the two
  template tracks, the registry, the local API and deep link, an
  honest pre-release state) with the developer section kept at the
  bottom, plus `docs/REGISTRY.md` — using the community registry from
  the app (accounts, publishing, saving, offline sync, the shared
  server URL) and hosting one (Docker image, terminal database
  commands, configuration, the HTTP surface, upgrading)
- The delivery e2e harness builds the virtual-printer fixture into the
  workspace's `target/fixture` instead of the fixture's own source
  tree: the Docker test container runs as root on a bind-mounted
  checkout, and the root-owned `target/` it left behind made CI's
  host-side fixture step (`rust-test-linux`) fail with a permission
  error on every run
- The registry's auth rejection now carries a JSON body, keeping the
  documented "all bodies are JSON" contract — an expired or missing
  session token used to get back an empty `401`
- Japanese interface language: the whole UI is translated (templates,
  both editors, the print screen, the registry, settings and every
  dialog), with a language switcher in Settings — the choice is saved
  and comes back on the next start
