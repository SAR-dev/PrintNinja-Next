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
