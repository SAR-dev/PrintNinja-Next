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
