# Architecture

> **Who this is for:** anyone new to the codebase, or anyone who wants the
> big picture before opening a specific crate.
> **What you will know after reading:** what each crate does, how a print
> travels from template to paper, what the app shell adds around the
> pipeline, what the community registry stores, and how the tests keep it
> all honest.

PrintNinja (next) is a local-first app that turns **templates** into
**printer jobs** for thermal, receipt, label and page printers — plus a
small **community registry server** for sharing templates. 🖨️ It is the
greenfield rewrite of PrintNinja, built phase by phase under
[`planned/REFACTORING-PLAN.md`](planned/REFACTORING-PLAN.md). The top
priority is reliability: a job either prints, or the user gets a specific
reason why it did not. "Sent" must never mean "the printer silently threw
it away".

```text
template + data ──▶ scene ──▶ render ──▶ plan ──▶ encode ──▶ transport ──▶ honest result
                     │          │         │          │           │
                  (pn-      (pn-     (pn-     (pn-encoders  (pn-job +
                  scene)    render)  planner) or pn-render   pn-transport)
                                            or pn-browser
```

## The Rust workspace

One workspace (`Cargo.toml` at the repo root), twelve members. The rule
that keeps them composable: `pn-scene` is the shared vocabulary, `pn-job`
is the only crate that orchestrates the others, and the app crate (or the
registry) sits on top.

| Crate | Path | What it does |
| --- | --- | --- |
| `printninja` | `app/` | The Tauri 2 app: the thin shell around the pipeline, the local store, the local print API, the registry client (see [The app](#the-app)). |
| `pn-scene` | `core/scene/` | The scene template format: a JSON description of a template (page geometry, elements, `{{data}}` bindings) plus **expansion** — template + data records → a deterministic list of pages/labels. The same file drives preview and print. |
| `pn-render` | `core/render/` | The in-process renderer: text shaping with font fallback (including Japanese), barcodes and QR, 1-bit bitmaps at the printer's dpi, and PDF output for `page` media. Deterministic — the same input gives the same bytes on every platform. |
| `pn-planner` | `core/planner/` | Picks the output path per job from the template's track and the printer profile: `native` → `raster` on thermal media, `pdf` for scene `page` media, `browser` for the html document track. Never emits bytes; records *why* it fell back. |
| `pn-profiles` | `core/profiles/` | Printer profiles: one TOML file per model under `core/profiles/profiles/` (language, dpi, head width, delivery pacing, status query, quirks). Data, not code — adding a printer means adding a profile, not changing a crate. |
| `pn-encoders` | `core/encoders/` | One module per thermal language (ESC/POS, ZPL, TSPL, CPCL) with two entry points: `native()` (the printer's own fonts and barcode generators) and `raster()` (a thin wrapper around `pn-render`'s bitmaps). |
| `pn-browser` | `core/browser/` | The html document track: one-shot `--print-to-pdf` against the desktop OS's own browser (Edge on Windows, Chromium/Chrome on Linux). std-only, no CDP, no downloaded binary; failures are honest plain words. |
| `pn-transport` | `core/transport/` | The four delivery adapters: raw TCP/JetDirect, the Windows spooler, IPP/CUPS, and Bluetooth (RFCOMM on Linux, the paired device's COM port on Windows). Language-blind: it moves bytes, paces them per the profile, and reports byte-level facts. |
| `pn-job` | `core/job/` | The job orchestrator and the only owner of the result states (see below). Asks the printer before and after, reads status replies in the profile's dialect, paces the bytes, and reports what actually happened. |
| `pn-server` | `server/` | The community registry: an axum + tokio HTTP service with a rusqlite database, argon2 password hashing and hashed session tokens (see [The registry](#the-community-registry)). |
| `golden-harness` | `tests/golden/` | The golden-file test harness: pins exact byte sequences in `tests/golden/cases/`, regenerated with `GOLDEN_UPDATE=1 cargo test`. |
| `pn-e2e` | `tests/e2e/` | The delivery e2e harness: drives the real `pn-transport` + `pn-job` against the virtual-printer fixture (see [The test pyramid](#the-test-pyramid)). |

`tests/e2e/support/virtual-printer` is deliberately **excluded** from the
workspace: it is a standalone std-only crate with its own `Cargo.lock`,
compiled on demand and spawned as a subprocess by the e2e tests.

## The print pipeline

Everything that prints — the UI, the local print API, the e2e tests —
goes through the same path, wired up in `app/src/pipeline.rs`
(`prepare_units` → `print_units`):

1. **Validate and load** — the template parses, the printer profile
   exists, the data is records (JSON or CSV). Delivery overrides from the
   settings screen (pacing, close delay) are applied to the profile.
2. **Expand** (`pn-scene::expand`) — template + data records → a list of
   pages, labels or receipt cuts. Deterministic: the same input gives the
   same pages, which is what the golden tests pin.
3. **Plan** (`pn-planner::plan`) — the track and media pick the path:

   | Track | Media | Path |
   | --- | --- | --- |
   | `html` | `page` | browser (PDF via the headless browser) |
   | `scene` | `page` | PDF (the Rust renderer) |
   | `scene` | label / roll | native → raster, with the refusal reason recorded |

4. **Encode** — `pn-encoders::native` or `pn-encoders::raster` for
   thermal media; `pn-render::render_pdf` for scene `page` media;
   `pn-browser::render_pdf` for the html document track. The preview the
   user sees is the output of this same step.
5. **Deliver and verify** (`pn-job::run` + `pn-transport`) — one unit at a
   a time, paced per the profile, with a status query before and after
   where the printer answers one.

### Honest job results

Every job ends in one of the states from `pn-job` (`core/job/src/run.rs`),
shown to the user in the words of `app/ui/src/result-words.ts`:

| State | Meaning |
| --- | --- |
| **Confirmed** | The printer's own reply confirms no fault. |
| **Sent, not confirmed** | Bytes were accepted, but this printer cannot confirm. The UI says so. |
| **Partially printed** ("N of M", with the reason) | The job stopped before the last unit — a batch can partially print. |
| **Failed** (with reason) | Nothing was printed, or the failure happened before printing. |
| **Wrong mode suspected** | Data was accepted, but the profile says the printer ignores this language in its current mode. |

Retry is honest too: it is only offered for failures that happened before
any byte was flushed, so a retry can never print a job twice.

## The app

`app/` is the `printninja` crate — a Tauri 2 shell (Windows and Linux;
Android is a later phase). `app/src/lib.rs` is deliberately thin: it
holds the loaded printer profiles, exposes the pipeline through a small
set of Tauri commands (`list_printers`, `plan_job`, `print_job`, template
and settings persistence, registry commands), and wires up the plugins.

**The UI** lives in `app/ui/` — React + TypeScript built with Vite,
styled with Tailwind, built on Radix UI components, with i18next
bootstrapped for localization (the interface ships in English and
Japanese, switchable in settings, and the renderer already carries a
Japanese font fallback so *prints* can be in Japanese).
`app/ui/src/App.tsx` is the
view router — a `View` state machine over five screens: the template
**list** (with Mine / Community / Saved tabs), the **print** screen, the
scene **editor**, the **document** (HTML/CSS) editor, and **settings**.

**The local store** is one SQLite file — `printninja.db` in the app's
data directory (`app/src/lib.rs`, backed by `app/src/store.rs`).
Templates, recent jobs (the last 10, with reprint/retry) and settings all
live there. If the store cannot open, the app still runs and names the
failure.

**The local print API** (`app/src/api.rs`) is the same pipeline over HTTP
on `127.0.0.1:17717`: a till, a script or a web page on the machine can
list printers and templates, submit a job (`POST /v1/print`), track and
cancel jobs, and retry — with identical verification and result states as
the UI. An `Idempotency-Key` header makes retries safe: the same key comes
back the original job (409) and never prints twice. **LAN exposure**
(`app/src/pairing.rs`) is an opt-in setting, off by default: the PC opens
a short-lived window with a one-time code, a device claims it and receives
a per-device token (only its SHA-256 is kept on the PC), and a token gate
admits requests from off this PC.

**Deep links** (`app/src/deeplink.rs`): `printninja://print?…` from a web
page prefills the print screen (template by name, printer, copies) and
stops there — the Print button on the screen is the confirmation, because
a link carries no identity.

**Living in the tray**: a second launch focuses the running window
(`tauri-plugin-single-instance`), the window's close button hides the app
to the tray instead of quitting, and "Quit PrintNinja" in the tray menu is
the way out. Start-with-computer uses `tauri-plugin-autostart` and survives
restarts.

## The community registry

`server/` is `pn-server` — the community registry (plan phase 9). It
stores **published templates** (the template document plus a name, slug
and readme), **accounts**, **per-account saves** and a **change feed**
(with tombstones) that the app syncs against. It validates every template
with `pn-scene` — the same parser and checks the app runs — but it never
renders or prints: it stores, validates and serves.

- **Accounts are handles + passwords** (`server/src/auth.rs`) — no email,
  no password reset. The handle is stored as typed and matched on its
  lowercase key; passwords are argon2id; sessions are Bearer tokens of
  which only the hash is stored.
- **Offline-first sync** lives in the app, not the server
  (`app/src/registry.rs` + the operation queue in `app/src/store.rs`):
  publish, unpublish, save and unsave are queued as operations while
  offline and replayed when the connection returns; the app's community
  mirror follows the change feed. Offline is a state, not an error.
- **Database**: plain portable SQLite (`server/migrations/0001_initial.sql`),
  so the same schema runs on a local file, in memory, and on a hosted
  backend like **Turso** (the production database). Migrations are applied
  in file-name order by `pn-server migrate apply` (and automatically by
  `pn-server serve`); `migrate make <name>` writes the next file and
  `db reset` rebuilds from scratch — terminal commands, the way you would
  expect from any other project.
- **Self-hostable**: `server/Dockerfile` bakes the binary and migrations
  into an image with the database on a `/data` volume. CI pushes it to
  **GHCR** on every push to `main` (`server-publish`), and
  [`REGISTRY.md`](REGISTRY.md) is the user guide for running your own.

## The test pyramid

```text
        /\        e2e against the virtual printer (real transport + job crates)
       /  \       ────────────────────────────────────────────────────────────
      /    \      golden files (exact bytes per encoder × profile × case)
     /      \     ────────────────────────────────────────────────────────────
    /        \    unit tests in every crate
```

- **Golden files** (`tests/golden/`, `GOLDEN_UPDATE=1 cargo test` to
  regenerate): `tests/golden/cases/` pins the exact bytes the encoders,
  renderer and scene expansion must produce — encoder × profile × case. A
  changed byte is a visible diff of a committed file.
- **Virtual-printer e2e** (`tests/e2e/`): the fixture in
  `tests/e2e/support/virtual-printer` is a standalone subprocess that
  answers real Raw/JetDirect, LPD, IPP and HTTP traffic and can be jammed,
  powered down or set to paper-out via its HTTP state control
  (`/set?state=…`). `pn-e2e` spawns one per test on OS-chosen ports and
  drives the shipped `pn-transport` and `pn-job` end to end:
  `delivery.rs` (confirmed, unconfirmed, partial, failed),
  `raster_pipeline.rs` and `native_pipeline.rs` (both thermal paths,
  cross-platform-identical bytes), and `document_track.rs` (html → PDF →
  IPP, and the honest no-browser error where no browser exists).
- **The full Rust suite runs in a Docker test container, never natively**:
  `pnpm test:rust` (compose: `tests/docker-compose.test.yml`, image:
  `tests/Dockerfile.test`). The cap is the point — `CARGO_BUILD_JOBS=2`
  and 6 GB of memory mean an over-sized compile fails fast inside the box
  instead of wedging the host, and `target/` lives in a named volume so
  only the first run compiles everything. `pnpm test:rust:report` writes a
  JUnit report on top.
- **CI** (`.github/workflows/ci.yml`, documented in [`CI.md`](CI.md)):
  `web-check`, `rust-lint`, `rust-test-linux` (the Docker container, then
  the fixture tests on the host), `rust-test-windows` (native),
  `chromium-render` (a real system Chrome proves the document track; the
  Docker container deliberately has no browser), a `rust-check` gate job,
  and the registry jobs `server-check`, `server-image`, `server-e2e`
  (the full HTTP lifecycle via `server/e2e.py` against the container) and
  `server-publish` (GHCR, main pushes only).

## Platforms

| Platform | Status |
| --- | --- |
| 🪟 Windows | Shipped — MSI bundle, code-signed on release (`docs/RELEASE.md`). |
| 🐧 Linux | Shipped — deb and AppImage bundles. |
| 📱 Android | The next phase (phase 11): shared renderer, planner, profiles and encoders, Android transport adapters and a background print service. Not built yet. |
| 🍎 macOS | **Never** — a permanent decision, not a deferred one. |

The renderer, planner, profiles and encoders are identical on every
platform; only the transport adapters differ. That is what makes the
"same template, same bytes on every machine" promise testable in the first
place.

## Where to read next

| You want to… | Read |
| --- | --- |
| Know *why* the architecture is shaped this way | [`planned/REFACTORING-PLAN.md`](planned/REFACTORING-PLAN.md) |
| Run, build or change the codebase | [`DEVELOPMENT.md`](DEVELOPMENT.md) |
| Run or self-host the registry | [`REGISTRY.md`](REGISTRY.md) |
| Cut a release | [`RELEASE.md`](RELEASE.md) |
| Read the CI matrix | [`CI.md`](CI.md) |
