# ✨ Features

> **Who this is for:** anyone who wants to know everything PrintNinja (next) can do.
> **What you will know after reading:** what each part of the app offers, how a print actually travels to the paper, and what is still on its way.

**Jump to:** [🎨 Templates & designer](#-templates--designer) · [🖨️ Printer profiles](#️-printer-profiles) · [🚚 Print pipeline & transports](#-print-pipeline--transports) · [🕘 History & reprint](#-history--reprint) · [🔌 Print from elsewhere](#-print-from-elsewhere) · [🌍 Community registry](#-community-registry) · [⚙️ The app itself](#️-the-app-itself) · [📦 Release tooling](#-release-tooling) · [🚧 Still on the way](#-still-on-the-way)

## 🎨 Templates & designer

Two tracks, one app — a template's `format` field picks the track, and a template never mixes them:

- **🏷️ Scene** (the default, every media kind) — a JSON document that describes the media in millimetres (a fixed-size **label**, a continuous **roll**, or **page** paper) and its elements: text, image, barcode, QR code, line, rectangle, and **repeating groups** bound to a data array. `{{field}}` bindings fill values from your data, a declared field list catches a mistyped binding before a job is queued, and validation reports the problem in plain words.
- **📄 Document** (`page` media only, rejected on thermal) — real **HTML/CSS** with `{{field}}` substitution. The app renders it to PDF with the desktop's own headless browser (Edge, Chromium or Chrome) and sends it over the OS print path. Good for invoices and delivery slips.

**The designer:**

- **Scene editor v1:** the page is a canvas — click an element to select it, drag to move (0.1 mm steps). Add or delete text, lines, rectangles, barcodes, QR, images and repeating groups; edit position, size, content with `{{bindings}}`, text size/bold/italic/align, barcode kind, fill, page placement (`every`, `first`, `last`, `only n`, or `flow` for groups) and the group's column width and row gap. Media dimensions in mm, and the declared data fields follow the bindings the elements actually use.
- **Document editor v1:** the document's code, the paper size (A4/A5/Letter presets included) and sample data, with a live browser preview showing the first record substituted the way the print does it. (The richer CSS designer toolbar is post-v1.)

**Data and preview:**

- Data is **JSON** (an array of objects — one record, one label or one output) or **CSV** (RFC 4180: header row, quoted fields), typed in or loaded from a local file.
- One record expands to one output: a label is exactly one page; a roll or page output is a strip cut at the page height, with repeating groups flowing down it and `last`-placed elements reserving the bottom of every page. A record that would overflow its label fails the job **naming the record and the field** — no silently dropped rows.
- The preview expands to **every page**: a scene job lists all its pages (a thumbnail grid when there is more than one), a document job shows the actual PDF(s) the printer will receive. What you see is what gets printed — the preview and the print run through the same renderer.
- **Barcodes and QR** in the scene track: Code 128, Code 39, Code 93, EAN-13, UPC-A, ITF, and QR (error correction M). The same encoders drive preview and print, and every symbology is proven scannable — the rendered page is decoded back to the value in tests.
- **Text with font fallback:** the renderer embeds Noto Sans and Noto Sans JP, and a character the primary family does not carry is re-shaped in the next embedded font — so Japanese renders on the default family. Alignment, faux bold and faux italic included.

## 🖨️ Printer profiles

Printer facts live in data, not code: **one TOML file per model**, shipped in `core/profiles/profiles/`.

- **Eleven ship with the app:** Zebra GK420d, ZT411 and ZD421; TSC TTP-244 Pro; Citizen CT-S500 and QL-820NWB; Epson TM-T88VII; Rongta RP325; a generic 58 mm thermal; an office laser through CUPS; and B-FP2D.
- Each profile names the printer's **language** (ZPL, TSPL, CPCL, ESC/POS, or PDF for a document printer), media, dpi and head width, fonts and code pages, native barcode types, delivery pacing (chunk size, pause, close delay) and its **status dialect** — plus any quirks, each with a link to the evidence that proved it.
- The profile loader cross-checks fields (for example `head_width_dots` against dpi × printable width), so a typo is caught, not printed.
- **User overrides:** pacing fields you leave in Settings (chunk size, pause, close delay) are stored in the local settings store and merged field-by-field over the profile per job — the shipped profiles are never touched, and a broken saved row can never fail a print.
- All eleven ship as `untested` until they pass the per-profile hardware checklist on real printers (that is phase 10) — see [Known limitations](./LIMITATIONS.md).

## 🚚 Print pipeline & transports

One pipeline, decided per job, with the reasoning you can read:

- **The planner** picks the output path from the template's track and the printer's profile: a scene on thermal media tries the printer's **native language** first (text in the printer's own fonts, printer-generated barcodes — tens of bytes instead of a bitmap), falls back to **raster** (the app renders the page to a 1-bit bitmap at the printer's dpi and wraps it in the profile's language) when the scene outgrows the language, and uses **PDF** for the OS print path on page paper. Every fallback is recorded as a sentence, not an error code.
- **Transports** (choose where the bytes go on the print screen):
  - **Raw port (TCP / JetDirect):** for network thermal printers — profile-driven pacing, a send deadline so a wedged printer cannot hang the job, and a close delay from the profile.
  - **Windows spooler:** any printer Windows already knows, by its queue name — including office lasers; full-write verification per unit and a plain-words reading of the spooler's fault bits.
  - **IPP:** CUPS queues on Linux, or a printer's own IPP interface — one Print-Job per unit, with the reply checked for honesty.
  - **Bluetooth:** Linux dials the paired device's RFCOMM socket directly; Windows writes to the device's SPP COM port (`COM7` named directly, or a MAC whose port is looked up).
  - **USB needs no adapter of its own:** a USB printer is a CUPS queue on Linux and a spooler queue on Windows — use IPP or the spooler.
- **Honest job results** — every job ends in one of these, shown in plain words:
  - ✅ **Confirmed** — the printer's own status or reply confirms completion
  - 📮 **Sent, not confirmed** — the bytes were accepted, but this printer cannot confirm; the app says so instead of pretending
  - ⚠️ **Partially printed** — "1 of 2 printed", with the reason (for example paper out mid-batch)
  - ❌ **Failed** — with the reason, in the printer's own words where it has them
  - 🤔 **Wrong mode suspected** — the printer accepted data it will ignore in its current mode
- **Status checks with common sense:** a preflight check before sending and mid-batch checks while a long job runs, using the profile's status query — and only when the profile says the printer actually answers it. Silence never blocks a print.
- **Retry rules, stated honestly:** the one automatic retry happens only when the failure landed **before any byte was flushed** (connection refused, nothing sent) — so it can never print a duplicate. A failure mid-transfer is a hard failed/partial result; you restart it explicitly.
- **One job at a time per printer:** jobs for the same printer run in a serial queue, so batches can never interleave.
- The whole pipeline is exercised end-to-end against a **virtual printer** in CI: a confirmed job with its bytes verified on disk, an unconfirmed one, a dropped connection, a send-deadline hit mid-unit, a paper-out mid-batch reporting "1 of 2", and back-to-back jobs serialized.

## 🕘 History & reprint

- Every job you print — success, failure or partial — lands in **Recent jobs** (the newest ten), remembering the template content **as it was at print time**, the data, the copies and the transport.
- Each row shows its result in the pipeline's own vocabulary — including the "N of M" counts for a partial batch.
- **Reprint** re-runs the exact same job (the frozen template — even if you edit it later); a failed or wrong-mode job gets a **retry** instead. The row shows the new result and time when it finishes.
- Templates, recent jobs and settings are all kept in one local SQLite file — and the app still runs if the store cannot open, naming the failure in the footer instead of losing your edit.

## 🔌 Print from elsewhere

- **🌐 Local print API (HTTP)** on `127.0.0.1:17717` — local by default, nothing off this PC can reach it. `GET /v1/health`, `GET /v1/printers`, `GET /v1/templates`; `POST /v1/print` (a saved template by name, a printer, JSON or CSV data, copies, and a transport — or the saved default for that printer) queues the job at once and answers 201 with its id; `GET /v1/jobs` and `GET /v1/jobs/{id}` say where it stands and what it came out to; `DELETE` cancels a job that has not started, `POST …/retry` re-runs a finished one.
- **🔁 Idempotency:** a retried request with the same `Idempotency-Key` header comes back the same job — 409, the original id, nothing new printed. Tills and scripts can retry safely.
- **📡 LAN exposure** (opt-in in Settings, off by default): the API listens on your network too, and a request from off this PC must carry its paired device's token. Pairing uses a short-lived one-time 8-character code (90 seconds, single use, five wrong codes lock the window); the PC stores only the SHA-256 of the token, and the paired-devices list can revoke one at any moment.
- **🔗 Deep link** — `printninja://print?…` from a web page, a message or the shell opens the app (cold or warm) and prefills the print screen: the template by name, an optional printer and copy count. It stops there: a link carries no identity, so pressing Print is the confirmation for every source — and a link with no template, a template this app does not have, or one that cannot be read says so in plain words.

## 🌍 Community registry

The community registry (phase 9) — publish your templates, discover others, print offline:

- **👤 Accounts are handle + password, no email** (1–32 characters of A-Z a-z 0-9 `_` `-`). A new handle + password at sign-in simply creates the account. Passwords are argon2id; only the SHA-256 of a session token is stored.
- **📤 Publish** a template with a name, a per-account slug and an optional sample of starting records — checked with the same parser and validation the app runs, so the registry never renders or prints, and everything it accepts is something the app can open.
- **🔎 Browse** the gallery — search over name, readme and owner, a track filter, newest first — no sign-in needed to look around.
- **💾 Save** a community template: it materializes as an editable local copy on your machine, printable offline; unsave when you are done.
- **📴 Offline-first:** the Community list works offline, showing what the last sync saw; publishes, unpublishes, saves and unsaves made while disconnected queue up and replay when the connection returns. A status chip (online, who is signed in, how many operations are waiting) and a Sync button live in the template list.
- The server address is the `registry.url` setting — point the app at any shared registry URL. How the registry works, and how to host your own, is in [REGISTRY.md](./REGISTRY.md).

## ⚙️ The app itself

- **🌙 Appearance:** light or dark, remembered on the next start.
- **🖥️ Start with computer:** the OS autostart entry, on or off from Settings.
- **🔽 Close to tray:** the window's close button hides the app; a tray icon (left-click brings it back) and its menu hold the way back and the way out.
- **🎛️ Per-printer settings:** one card per printer for its pacing — chunk size, pause between chunks, close delay. An empty field uses the value the profile ships with, shown as the placeholder.
- **🆕 Update check (manual):** on boot the app compares its version with the latest GitHub release and shows an "Update to vX.Y.Z" badge in the top bar. The badge opens the release page, where you download and update by hand — there is no auto-update, by design (see [Known limitations](./LIMITATIONS.md)).

## 📦 Release tooling

- **📅 Date versions:** versions come from the date — `YYYY.MMDD.N` (for example `2026.1124.0`) — so nobody types a number, and two people releasing on the same day cannot collide.
- **💻 Local release script:** `pnpm release` sets the version and tag from a clean `main`; `node scripts/release-local.mjs` also runs the checks, builds what the host OS allows (Windows: MSI; Linux: deb/AppImage) and updates a draft GitHub release.
- **🤖 CI builds:** pushing a `v*` tag builds the installers in CI (`windows-build`, `linux-build`) and attaches them to a draft GitHub release (`github-release`).
- **🐳 Server image:** the registry is published as a Docker image to GHCR on every release, tagged with the same date version as the app, so a server image can be matched to an app release (it is skipped automatically when nothing in the server changed).
- The full walkthrough — signing, publishing, the server image — is in [RELEASE.md](./RELEASE.md).

## 🚧 Still on the way

Not shipped yet — listed here so nobody thinks they are:

- **📱 Android (phase 11):** the app for phones — thermal media (labels, receipts) via the scene track only, plus a background print service third-party apps can print through. The **build** side is already done: CI compiles the Android bundle on pull requests (`android-check`, debug APK) and ships a signed APK + AAB on release tags (`android-build`) — what remains is the app-level work (transport adapters, the print service).
- **🧪 App-level (UI) e2e:** not in the repo yet. The e2e suite today is Rust-driven, against the virtual printer — a Playwright e2e is a phase 10 decision, if wanted.
- **🖨️ Hardware verification (phase 10):** the per-profile checklists run on real printers, the failure drills, and the first release candidates.

[⬅️ Back to the README](../README.md)
