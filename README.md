<div align="center">

# PrintNinja (next)

**🖨️ Print receipts, labels and documents. No print dialogs, no driver headaches.**

The greenfield rewrite of [PrintNinja](https://github.com/SAR-dev/PrintNinja), built phase by phase under [`docs/planned/REFACTORING-PLAN.md`](docs/planned/REFACTORING-PLAN.md).

**🚧 Status: pre-release** — phases 1–8 are done and phase 9 (the community registry) is landing. There is no installer yet: build from source, below. Windows 🪟 and Linux 🐧.

[🚀 How a print works](#-how-a-print-works) ·
[🖨️ Printers](#-printers) ·
[📐 Templates](#-templates) ·
[🌍 Community registry](docs/REGISTRY.md) ·
[🔌 Print from elsewhere](#-print-from-elsewhere) ·
[👩‍💻 Developers](#-developers)

</div>

---

## 🥷 What is PrintNinja?

PrintNinja prints for you, quietly, without the usual fuss. You pick a printer, pick a layout, enter the data, and press **Print**. The paper comes out. 🎉

It is built for people who print the same things again and again:

- ☕ **Shops and cafés** printing receipts and kitchen tickets
- 📦 **Delivery and warehouse teams** printing shipping and parcel labels
- 🏢 **Offices** printing invoices and delivery slips
- 🖨️ **Anyone** who wants printing on a PC to just work

**✨ What you get**

- 🚫 **No pop-up print windows.** Jobs go straight to the printer.
- 💬 **A clear answer every time.** Every job ends in a word you can act on: **Confirmed**, **Sent, not confirmed**, **Partially printed** ("1 of 2 printed", with the reason), **Failed**, or **Wrong mode suspected** — never a silent "probably fine".
- 🕘 **A history of every print,** with one-tap reprint and retry.
- 📴 **Works without internet.** Printing and local editing never wait on a server.
- 👀 **A preview of every page before anything is sent**, barcodes and QR codes included.
- 🌍 **A community registry:** publish your templates, browse and save other people's, and offline changes sync when the connection returns ([guide](docs/REGISTRY.md)).
- 📄 **Two template languages:** a scene format for thermal media and full HTML/CSS for page paper.

## 🚀 How a print works

1. **Pick a template** — from your local list, or create a new one (scene or document).
2. **Pick the printer** — it is one of the bundled [profiles](#-printers); the profile knows the printer's language, media and quirks.
3. **Choose where the bytes go** — raw port (TCP), IPP, the Windows spooler, or Bluetooth (see below).
4. **Enter the data** — JSON or CSV, typed or loaded from a file. The preview shows every page the batch expands to.
5. **Print.** The result appears as a plain word, and the job lands in *Recent jobs* where you can reprint or retry it.

## 🖨️ Printers

Each supported model is a **profile**: one small TOML file that names the printer's language, media widths, status dialect and quirks. Eleven ship with the app — Zebra GK420d, ZT411 and ZD421; TSC TTP-244 Pro; Citizen CT-S500 and QL-820NWB; Epson TM-T88VII; Rongta RP325; a generic 58 mm thermal; an office laser through CUPS; and B-FP2D. **All are `untested` until hardware-verified** (that is phase 10), so treat a first print on a new model as a test print.

How the bytes reach the printer — pick one on the print screen:

| Where the bytes go | When to use it |
|---|---|
| **Raw port (TCP)** | Network thermal printers (JetDirect-style raw port 9100). You type the host and port. |
| **IPP** | CUPS queues on Linux, or a printer's own IPP interface. You type the address, like `http://printer:631/ipp/print`. |
| **Spooler (Windows)** | Any printer Windows already knows, by its queue name — including office lasers. |
| **Bluetooth** | Paired handheld printers: Linux dials the RFCOMM socket, Windows writes to the device's COM port. |

🔌 **USB printers need no extra setup:** a USB printer is a CUPS queue on Linux and a spooler queue on Windows — use IPP or the spooler.

🛣️ **How a job is encoded** is decided per job, and you can tell why: the planner tries the printer's own **native language** first, falls back to **raster** (the app renders the page to bits and sends a bitmap), and uses **PDF** for the OS print path when the media is page paper. When something is refused, the refusal is a sentence, not an error code.

## 📐 Templates

Two tracks, one app:

- **Scene** (the default, all thermal media): a JSON document that describes the media (label, continuous roll, or page, in millimetres) and its elements — text, image, barcode, QR, line, rectangle, and repeating groups — with `{{field}}` bindings to your data. Good for labels and receipts.
- **Document** (page paper only): real HTML/CSS with `{{field}}` substitution. The app renders it to PDF through your browser (Edge, Chromium or Chrome must be installed) and sends it over IPP or the spooler. Good for invoices and delivery slips.

Data is **JSON** (an array of objects — one record, one label or page) or **CSV** (RFC 4180: header row, quoted fields). A record that would overflow its label fails the job naming the record and the field, instead of silently dropping a row.

## 🌍 Community registry

Publish a template to the community gallery, browse what others have published, and save templates you like as editable local copies. Accounts are **handle + password, no email** — and everything is offline-first: publishing while disconnected is queued and syncs when the connection returns.

👉 The full guide, including **hosting your own registry server**, is in [`docs/REGISTRY.md`](docs/REGISTRY.md).

## 🔌 Print from elsewhere

- **🔗 Local print API (REST)** on `127.0.0.1:17717`: list printers and templates, submit a job, track its status, cancel or retry. A request retried with the same `Idempotency-Key` comes back the original job — it never prints twice.
- **📡 LAN exposure** (opt-in, off by default): the same API on your local network, with per-device one-time pairing codes. Other devices on your LAN can print through this one.
- **🔗 Deep link** (`printninja://print?...`): a web page or another app can prefill the print screen (template, printer, copies). The screen is always the confirmation — a link carries no identity.

## ⚙️ Settings

Theme, start with the computer (with the tray icon and close-to-tray window), per-printer pacing and close-delay overrides, and the **registry server address** — point the app at any shared registry URL.

## 🚧 Honest state (pre-release)

- 📦 **No installer yet** — phase 10 cuts the first release candidates for Windows and Linux.
- 🖨️ **Profiles are `untested`** until the phase 10 hardware checks run on real printers.
- 📶 **`ipps://` / `https://` endpoints are not in yet** — TLS for the transports and the registry is a documented follow-up.
- 🇬🇧 **English only** for v1; i18n and the WCAG target are decided post-v1.
- 🤖 **Android is phase 11** (labels only, plus a background print service).
- 🍎 **macOS is out of scope, permanently.**

---

<a id="developers"></a>

## 👩‍💻 Developers

A greenfield rewrite, built phase by phase under [`docs/planned/REFACTORING-PLAN.md`](docs/planned/REFACTORING-PLAN.md). The current app (`PrintNinja`) keeps shipping; this repo is the rewrite.

### Layout

```
core/scene        scene format + data model — depends on nothing
core/render       Rust renderer: text shaping, bitmaps, PDF
core/planner      path selection: native | raster | OS print
core/profiles     printer profiles, TOML
core/encoders     one module per printer language (ZPL, TSPL, CPCL, ESC/POS, PDF)
core/transport    tcp / ipp / spooler / bluetooth adapters
core/job          job model: states, verification, retry, partial counts
core/browser      headless browser PDF for the document track
server/           the community registry (pn-server) + Dockerfile + e2e
app/              Tauri shell (Windows, Linux) + ui/ frontend
tests/golden      golden-byte test harness + committed golden files
tests/e2e/        virtual printer fixture (standalone crate) + e2e tests
```

Dependency rules are in the plan §5.11; the workspace enforces them.

### Requirements

- Rust 1.90.0 (pinned by `rust-toolchain.toml`; rustup installs it automatically)
- Node 22 + pnpm 10 (frontend, `app/ui`)
- Docker (full test suite; the container caps memory so an over-sized compile fails fast in the box instead of on the host)

### Quick start

```sh
# Frontend (must be built before any Rust build/test: the app crate
# embeds app/ui/dist via tauri::generate_context!)
pnpm -C app/ui install
pnpm -C app/ui build

# Rust workspace
cargo build
cargo test

# Full suite in the Docker test container (mirrors CI):
pnpm test:rust
# JUnit report:
pnpm test:rust:report

# Virtual printer fixture (standalone, std-only, builds in under a second):
cargo test --manifest-path tests/e2e/support/virtual-printer/Cargo.toml
```

### The registry server

```sh
# Terminal database commands (also work from inside the container):
cargo run -p pn-server -- migrate status
cargo run -p pn-server -- migrate make add_the_thing
cargo run -p pn-server -- migrate apply
cargo run -p pn-server -- db reset

# Serve, then the HTTP surface is on 127.0.0.1:8787
cargo run -p pn-server -- serve

# Or the deployable image:
docker build -f server/Dockerfile -t printninja-server .
docker run -p 8787:8787 -v registry-data:/data printninja-server
# e2e against any running server:
python3 server/e2e.py http://127.0.0.1:8787
```

Full hosting guide: [`docs/REGISTRY.md`](docs/REGISTRY.md).

### CI

`.github/workflows/ci.yml`: `web-check` (frontend build), `rust-lint` (fmt + clippy, `-D warnings`), `rust-test-linux` (workspace tests in the Docker container + fixture tests), `rust-test-windows`, `chromium-render` (the document track through a real system Chrome), the registry jobs `server-check` / `server-image` / `server-e2e` / `server-publish` (GHCR on push to main), and `rust-check` (a gate job that passes only when every Rust job passed).
