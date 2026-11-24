# Roadmap

The remaining work, as a checklist. Phases 0–9 are done —
the core pipeline, the app, the local print API and the community registry
are built and green (their state is documented across the other docs here).
What is left:

## Phase 10 — Hardening and hardware verification

- [ ] **Hardware-verify the profiles.** All 11 bundled profiles in
      `core/profiles/profiles/` are `status = "untested"`. For each printer
      that is on hand: run the checklist — minimal text, a label, a
      barcode, a long job, two jobs back to back — then flip the profile to
      `status = "verified"`. Quirks must carry Raw Console evidence.
- [ ] **Reconcile the open encoder items on real hardware**: the ESC/POS
      `GS k` symbology letters and the TSPL text multiplier (carried over
      from the native-path phase).
- [ ] **Real-hardware Bluetooth verification** — the RFCOMM adapter is
      e2e-green against the virtual printers only.
- [ ] **Failure drills**: paper out mid-batch, cover open,
      cable/Bluetooth drop mid-job, wrong mode detected, printer paused.
      Each must end in an honest result state with the reason, never a
      silent "sent".
- [ ] **Performance checks**: byte count and transfer time over Bluetooth
      for the native vs raster paths; start-to-result latency.
- [ ] **TLS transports**: `ipps://` / `https://` (a documented follow-up
      of the delivery phase).
- [ ] **Cut the first release candidate** — a `vYYYY.MMDD.N` tag once the
      items above that gate the release are done. The release pipeline
      (`version-check`, `windows-build`, `linux-build`, `android-build`,
      `github-release`) is already in CI.

**Exit:** the success criteria hold for every supported printer and
platform — a job prints or the user gets a specific reason within seconds;
no silent "sent" on printers that can confirm; adding a printer means a
profile plus a checklist run, not a code change; the same template gives
the same output on phone and desktop; a small Bluetooth label sends in a
fraction of the bitmap path's bytes. Release candidate cut.

## Phase 11 — Android

- [ ] **Android transport adapters**: Bluetooth, USB, network, and the
      Android print service where a driver exists (the renderer, planner,
      profiles and encoders are shared unchanged).
- [ ] **Background print service**: the app runs as a service third-party
      apps can print through — the Android counterpart of the PC local
      print API (other apps submit jobs; PrintNinja renders, plans and
      delivers them).
- [ ] **App redesign** (owner) — the phase 11 pass over the app for
      phones. The narrow-screen overlap that once failed the android
      `new-template` shots is fixed and the `screenshot-matrix` CI job is
      blocking again.

**Permanent constraints, not tasks:** Android prints thermal media via the
scene track only — no html document track, no headless browser on mobile.
macOS is out of scope permanently.

**Exit:** Android prints a batch of labels with per-label data (and a
variable-length receipt), including one submitted by a third-party app
through the background service.

## Needs fixing (audited 2026-11-24)

A scan of the app as it stands today — rough edges on shipped paths, found
by behavior inspection and verified against the code:

**Printers and discovery**

- [ ] **mDNS `_ipps` hits get an unusable prefill** — a network scan fills
      the form with `http://host:port` for every IPP discovery, but the IPP
      transport refuses TLS endpoints ("not implemented yet" — the phase 10
      TLS item). Mark TLS-only printers with a hint instead of handing over
      an address that cannot work.
- [ ] **A broken mDNS stack reports "0 found"** — the network scan's error
      path returns an empty list, so a firewall or a missing mDNS stack
      looks exactly like a quiet LAN. Distinguish a failed scan from an
      empty one.
- [ ] **Saved-printer rows hide their transport** — a saved row shows
      `name · model` and a Remove button only; the stored transport is never
      shown, and unlike a scan row (which has **Use**) there is no action to
      refill the form from a saved row.

**Plain-words errors**

- [ ] **A failed print can show the raw error string** — a `printJob`
      exception lands in the result card as `String(e)` (print-screen.tsx),
      while the URL-fetch path next to it already wraps its error in a
      locale string. The result card is the app's plain-words moment.
- [ ] **A printer-list load failure reads as a plan error** — the print
      screen catches `listPrinters` failures into the Preview card's
      plan-error slot, misattributing an unrelated load failure to job
      preparation.
- [ ] **A busy port 17717 is invisible** — when the local print API cannot
      bind, the failure is an `eprintln` only; the whole print-from-elsewhere
      feature is down and the user is told nothing (TROUBLESHOOTING.md even
      points at the console line).
- [ ] **Reprint and print keep different histories** — a reprint rewrites
      the recent-job row in place (`INSERT OR REPLACE`) while a fresh print
      prepends a new row; decide which is intended and make it one.

**Template CRUD and i18n**

- [ ] **No way to delete a local template** — the store has no delete for
      the templates table; a wrong or duplicate template can only be
      renamed into obscurity.
- [ ] **Template descriptions are not editable** — both editors save the
      original description unchanged; only the name has a field.
- [ ] **The scene editor cannot edit the template's sample data** — the
      document editor has the Sample data card, the scene one does not.
- [ ] **New-template names are hardcoded English** — "New label" / "New
      document" and their descriptions bypass the locale files, so a
      Japanese interface still creates English-named templates.

**Diagnostics (beyond the raw console listed above)**

- [ ] **No diagnostics story** — the render engine's status, the document
      track's browser choice, a log viewer with download, a one-click "fix
      PC printing" repair and an exported diagnostics bundle; the old app
      had all of it and the new app has none (TROUBLESHOOTING.md currently
      points at console output the app never shows).

**Docs and tests**

- [ ] **`docs/REGISTRY.md` over-promises hosted SQLite** — it says a hosted
      backend "like Turso works", but the server opens a local file path
      (rusqlite) and has no remote-URL support anywhere in `server/`. Soften
      the sentence or add URL support.
- [ ] **No e2e coverage of the LAN print-API gate** — pairing claim,
      lockout, token rejection, idempotency and cancel/retry exist only as
      unit tests inside `app/src/api.rs`; the security-relevant surface is
      the one major user-facing subsystem the e2e suite never touches.

## Feature gaps from the old app (audited 2026-11-24)

The previous app (`PrintNinja`) was checked feature by feature against
this one. The structural gaps are already covered: Android is phase 11,
"print via the PC" from a phone is the LAN local print API, and the
label languages (ESC/POS, ZPL, TSPL, CPCL, raster) are the encoders.
What the old app has that this one does not:

### Worth doing before the first release candidate

- [ ] **Test print** — one-click "print a test page" (page or text) from
      the saved-printer card, so a newly added printer is proven before
      the first real job (the old app's `test_printer`).
- [ ] **Capability probe on add** — when a printer is found or typed in,
      offer a detect that queries the (not yet saved) device and suggests
      the language and profile instead of the user picking by hand (the
      old app's one-tap "Detect").
- [ ] **Raw console (dev tool)** — hand-write bytes through the real
      transport, with a library of known-good per-language payloads,
      chunk/pause/settle overrides and a byte/timing report. The phase 10
      checklist already demands that quirks carry Raw Console evidence —
      the tool has to exist before the checklists can run.
- [ ] **Connection warnings in the saved-printer form** — plain-words
      warnings when the choice is likely wrong: a GDI-only spooler queue,
      IPP without PDF, raw TCP carrying a PDF.

### Post-v1 candidates (not yet ranked)

**Printers and printing**

- Per-printer overrides beyond pacing (paper width, dpi, media gap,
  raster band height) for when two printers share one profile.
- More barcode symbologies: EAN-8, UPC-E, Codabar, Data Matrix, PDF417,
  Aztec — the old app shipped 14; the scene track ships 6 + QR.
- Bluetooth on desktop: list the OS' paired devices and a jump to the OS
  Bluetooth settings (today the address is typed by hand).
- Advanced page options per job: orientation, fit modes, paper-size
  presets, margins, grayscale (the old app's AdvancedOptions).
- Data URLs: an allowed-domains allowlist alongside the private-IP block.

**Data and templates**

- Saved named datasets — reusable, synced sample data (today: inline
  JSON/CSV, file, URL).
- Template version history with restore.
- Helpers in `{{bindings}}`: currency, date, upper/lower, number, padLeft
  (the old app's mustache extras).
- A shared app-wide font library with sync (today fonts embed per
  template).
- More starter templates — the old app shipped six packs (receipt,
  delivery slip, invoice, shipping label, kitchen ticket, blank); this
  app ships two.
- Local search and sort on the Mine tab (Community already searches
  server-side).

**History and API**

- History depth: per-job detail with stage-timing breakdown, source tag
  (ui / api / deep link), idempotency key, requesting device; retention
  (auto-cleanup by days and max records); a full database reset.
- Batches: group jobs and reprint/retry a batch as one.
- Local print API: an in-app explorer that sends real requests, a
  changeable port and an autostart toggle (today fixed at
  `127.0.0.1:17717`), trusted deep-link sources (untrusted
  `printninja://` sources ask first).
- Guest invites — pairing without an account, with expiry and max uses.

**Accounts and sync**

- Sync scope beyond templates: datasets, fonts, profiles, settings —
  and the conflict-resolution UI that comes with it.
- Account extras: recovery codes, signed-in sessions list, change handle
  / change password.
- Paired devices: rename, per-device print permission.

**The app itself**

- Onboarding: a setup checklist (printer → template → first print).
- Command palette (Ctrl/Cmd+K) and keyboard shortcuts.
- Appearance extras: a system theme option, density, custom app name and
  logo.
- Background extras: start minimized, minimize-to-tray (close-to-tray
  and autostart already exist).
- Diagnostics: the document track's browser choice (auto / system /
  custom path), a log viewer with download, a one-click "fix PC
  printing" repair, an exported diagnostics bundle.
- A CUPS daemon URL setting (Linux).

**Checked and not gaps:** the label languages, USB (via the spooler /
CUPS queues, by design), pre-job status checks, the data URL's
GET/POST choice, copies, job cancellation (the API's `DELETE`), the
update-check badge, and the registry URL override all exist in some form
here.

## Before the first release tag

- [ ] The repository secrets `ANDROID_KEYSTORE_BASE64` +
      `ANDROID_KEYSTORE_PASSWORD` exist — the `android-build` job fails
      rather than sign with a throwaway key when they are missing.
- [ ] The registry is deployed (production DB on Turso) — an owner task,
      separate from the app release.

## Post-v1 (decided, deferred)

- i18n beyond the shipped languages and the WCAG 2.1 AA target (decided
  post-v1).
- Job history beyond the recent list: filters, batch reprint, CSV export,
  auto-cleanup.
- Local print API: callbacks, Prometheus metrics, OpenAPI document.
- A richer CSS designer toolbar for the document track (element palette,
  property panel).
- A Playwright e2e, if wanted — this app's e2e is Rust-driven against the
  virtual printers.
