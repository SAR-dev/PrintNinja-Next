# Glossary — PrintNinja

The words the app, the docs and the code use, in plain English. If a term
below and a sentence in the UI ever disagree, the UI wins and this page
gets fixed.

Jump to: 🧾 [The pipeline](#-the-pipeline) · 🖨️ [Printers](#-printers) ·
🔌 [Reaching a printer](#-reaching-a-printer) · 📦 [Jobs and results](#-jobs-and-results) ·
💾 [The local app](#-the-local-app) · 🌍 [The community registry](#-the-community-registry) ·
🚀 [Releasing](#-releasing)

---

## 🧾 The pipeline

A template plus some data becomes bytes for one printer. In order:

- **Template** — the reusable document: what to print and where. There
  are two kinds, called *tracks* (below).
- **Data field** — the fields a template fills in at print time (a name,
  a part number, a QR code…). Each record in the data becomes one unit
  of the job.
- **Sample** — the data field's starting records: what the preview shows
  and what tests and the registry publish alongside the template.
- **Scene track** — the declarative track: text, bars, rectangles,
  frames and repeating groups placed in millimetres. The encoders turn
  it into the printer's language.
- **Frame** — a bordered box in the scene track that holds other
  elements at coordinates relative to its top-left, nestable to four
  levels. At expansion it flattens into its border rect and its offset
  children, so preview and every encoder pick it up unchanged.
- **Document track** — plain HTML documents. They do not go through the
  encoders at all: a headless browser prints them to a PDF, and the PDF
  goes to the printer through the OS print path.
- **Headless browser** — the desktop OS's own browser (Edge on Windows,
  Chromium/Chrome on Linux) run one-shot with `--print-to-pdf`. No
  downloaded browser, no persistent process. `PRINTNINJA_BROWSER` points
  the app at a different binary.
- **Profile** — a small TOML file that describes one printer model: its
  language, media, DPI, printable width, fonts and barcodes it really
  has, how to pace the send, and how to ask it for its status. The
  shipped set lives in `core/profiles/profiles/` (overridable with
  `PN_PROFILES_DIR`). A profile's `status` says how far it has been
  verified: `verified`, `community` or `untested`.
- **Language** — the printer's own dialect. The encoders speak four
  thermal ones — **ZPL** (GK/Zebra), **ESC/POS** (Epson and others),
  **TSPL** (TSC) and **CPCL** (Citizen) — plus `pdf` for document
  printers, which have no native command language.
- **Raster vs native** — the two ways an encoder can build a page.
  *Raster* draws a 1-bit bitmap of the whole page (always works, a little
  heavier). *Native* uses the printer's own fonts and barcode commands
  (crisper, cheaper on the wire) — and when the profile does not list
  what the template needs, it falls back to raster and records the
  reason in plain words.
- **DPI** — dots per inch, the grid the print head draws on. A profile
  fixes it (203 for the GK420d, for example) together with
  `head_width_dots`.
- **Width in mm** — the media width, in millimetres. 58 mm and 80 mm are
  the common thermal widths; a profile records `printable_width_mm`, the
  part of the head that actually prints.
- **Media** — what the printer feeds: `label` (separate stickers),
  `continuous` (receipt roll) or `page` (A4/letter, document printers).

## 🖨️ Printers

- **Thermal receipt printer** — continuous roll paper, usually 58 or
  80 mm wide. No ink or ribbon.
- **Label printer** — prints individual labels or stickers off a roll.
- **Page printer** — an A4/letter printer (laser or inkjet). The app
  hands it a PDF through the OS print path and lets the OS own the
  queue and the fault states.
- **The models the profiles know** — GK (`gk420d`, ZPL), Zebra
  (`zd421`, `zt411`), TSC (`tm-t88vii`, TSPL), Epson (`ttp-244-pro`,
  `ql-820nwb`, ESC/POS), Citizen (`ct-s500`, CPCL), Ruijie (`rp325`,
  ESC/POS), `bf-p2d` (ZPL), a `generic-thermal-58mm` catch-all, and
  `office-laser-cups` for page printers.

## 🔌 Reaching a printer

- **Transport** — the language-blind pipe between the app and the
  printer. A transport does not know about ZPL or paper; the profile
  tells it how fast to write.
- **Raw / TCP / JetDirect** — the direct path: plain bytes over TCP,
  port 9100 by convention. No driver involved.
- **Spooler** — the Windows print system: the app hands the job to the
  OS queue and the OS delivers it.
- **IPP / CUPS** — the Linux path: the same idea as the spooler, through
  CUPS.
- **Bluetooth** — the transport for paired phones (RFCOMM on Linux, a
  COM port on Windows).
- **Status query** — the little question the app asks the printer for
  its state, before the job, between units and at the end. Each dialect
  has its own spelling: ZPL `^U`, ESC/POS `DLE EOT`, TSPL `~HS`,
  CPCL `@STA`. The reply can name faults in plain words — "it is out of
  paper", "its cover is open", "it is paused". Silence is an answer, not
  a failure.

## 📦 Jobs and results

- **Job** — one print request, frozen at print time: template, data,
  profile, transport, copies.
- **Unit** — one label or page inside a job: one data record, one copy.
  A 5-record template at 2 copies is 10 units.
- **Send plan** — the pacing of one send: chunk size and pause between
  chunks, the delay before the connection closes, and the deadlines —
  10 s to connect, 30 s to send, 3 s for a status reply.
- **Confirmed** — the printer's own status reply confirms no fault.
- **Sent, not confirmed** — the bytes were accepted, but this printer
  cannot confirm (its status query does not report what it printed).
- **Partially printed — N of M** — the job stopped before the last unit;
  N units were fully accepted before the fault. The reason names the
  fault ("the printer reports it is out of paper").
- **Wrong mode suspected** — the bytes were accepted, but the reply
  speaks a different dialect than the profile's language: the profile
  and the printer disagree.
- **The retry rule** — a job is retried once, and only when it failed
  *before any byte was accepted*. A failure after partial delivery is a
  hard result: no blind retry, you restart it on purpose.

## 💾 The local app

- **Local store** — one SQLite file, `printninja.db`, in the app's data
  directory. Templates, recent jobs, settings, saved printers, the
  registry mirror and the offline queue all live in it. The schema is
  created on open, so a missing file is not an error — a *failed open* is.
- **Saved printer** — a named row in the store: a display name, the
  profile the printer speaks, and the transport that reaches it (host,
  port, queue or MAC). A scan or a by-hand form creates one; picking it
  on the print screen fills in the profile and the transport. The
  profile is still the printer — the row only remembers where one lives.
- **Local print API** — the HTTP endpoint on the LAN that phones and
  other scripts print through. It only starts when the store opened.
- **Paired device** — a phone/tablet that claimed a pairing code. The
  PC keeps only a hash of its token, so it can check the
  `X-PrintNinja-Device-Token` header without ever seeing the token.
- **Deep link** — a `printninja://` URL that opens the app with the
  print screen prefilled (printer, copies).

## 🌍 The community registry

- **Handle** — the account name. Handles and passwords only, no email.
- **Publication** — one of *your* local templates pushed to the
  registry. One publication per local template: publishing it again is
  an update, which is also how offline edits get pushed.
- **Saved copy** — someone else's template, materialised in your app as
  a fully editable local template (its id is `saved-{owner}-{slug}`).
  From then on it is yours, offline and forever.
- **Sync queue** — the operations that were queued while you were
  offline (publish, unpublish, save, unsave), kept in order and replayed
  when the connection returns. *Offline is a state, not an error* — the
  queue waits.
- **Change feed** — the registry's ordered stream of publishes, updates
  and tombstones. The app walks it from its last cursor and mirrors the
  result locally; a tombstone drops the mirrored row.
- **Registry chip** — the line in the top bar: online or offline, who is
  signed in, and "N waiting" while N operations sit in the sync queue.

## 🚀 Releasing

- **Date version** — versions come from the date, `YYYY.MMDD.N`, where N
  counts that day's releases from 0 (room for 100 a day). You never type
  one: `pnpm release` picks the next free number.
- **wix.version** — the Windows override. An MSI version's first number
  is capped at 255, so a date version is rewritten for the installer:
  `2026.1124.3` becomes `26.11.2403` in `bundle.windows.wix.version`.
  The release scripts write it and remove it for non-date versions.
- **versionCode** — Android's build number, which must always go up:
  `YYMMDD*100+N` (for example `26112403`), written to
  `bundle.android.versionCode` in advance by the same scripts.
- **Release candidate (RC)** — the first cut of a release, made
  together with the hardware verification, before the release is
  published.
