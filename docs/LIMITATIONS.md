# 🚧 Known limitations

> **Who this is for:** anyone who tried something that did not work, and wants to know whether it is a bug or simply not built yet.
> **What you will know after reading:** what PrintNinja (next) cannot do today, what you will see when you try, and what to do instead.

These are not bugs. They are things the roadmap looks at and says "not yet" (or, in one case, "not ever"). The phase numbers refer to [`docs/ROADMAP.md`](ROADMAP.md).

**Jump to:** [💻 Platforms](#-platforms) · [🖨️ Printers](#️-printers) · [🌍 Registry and accounts](#-registry-and-accounts) · [📱 The app itself](#-the-app-itself)

<a id="platforms"></a>

## 💻 Platforms

**🍎 There is no macOS app — permanently.** The rewrite targets **Windows and Linux only** on desktop; macOS was decided out of scope in 2026-11-20 and is not a deferred feature. The current PrintNinja remains the macOS option until it is retired.

**📱 Android is not built yet (phase 11).** The renderer, planner, profiles and encoders are platform-independent, but the Android transport adapters, packaging and the background print service are not in this repo. When it lands, Android prints **labels only** (the scene track) — the document track and its headless browser stay desktop-only, permanently.

**📦 There is no installer yet (phase 10).** The repo is pre-release: the release tooling (date versions, the local release script, the CI installer builds and the GHCR server image) is in place, but the first release candidates are cut in phase 10, together with the hardware checks. Until then you build from source (the developer section of the README shows how).

<a id="printers"></a>

## 🖨️ Printers

**🧪 Every shipped profile is `untested` — until it is, it is.** The eleven bundled profiles were mined from the current app's code, not measured on a head. Hardware verification is per-profile: each profile runs its own checklist (minimal text, a label, a barcode, a long job, two jobs back to back) on the real printer and is only marked `verified` when it passes — that is phase 10. Treat a first print on a model you have not run the checklist for as a test print, and the "unconfirmed" results below are the honest price of that.

**🔓 Nothing is encrypted in transit.** Raw TCP (JetDirect), IPP over `http://`, Bluetooth and the registry server all talk in the clear — there is no TLS and no signing on any transport or on the registry yet. `ipps://`/`https://` endpoints are a documented follow-up. Use these only on a network you trust.

**🖨️ Spooled jobs never end up "Confirmed".** Jobs that go through the Windows spooler or CUPS end in spooler-level states: accepted → **Sent, not confirmed**, rejected → **Failed (with reason)**. The spooler — not the app — talks to the printer, so the app cannot claim more than the spooler tells it. This matches how the current app behaves for document printing.

**🔌 USB printers need a queue, not a cable.** There is no USB transport of its own: a USB printer is a CUPS raw queue on Linux (`lpadmin -p MyPrinter -m raw -v usb://…`) and an installed spooler queue on Windows (Printers & scanners → Add device). Then print to it over IPP or the spooler. Bluetooth is the one path that talks to the device directly.

**📄 The document track needs a browser installed.** `html` templates render to PDF with the desktop's own headless browser — Edge on Windows, Chromium or Chrome on Linux. If the machine has none (or none produces a PDF), the job fails with an honest error that includes the browser's own stderr excerpt — never a placeholder PDF.

<a id="registry-and-accounts"></a>

## 🌍 Registry and accounts

**🔑 There is no password-reset flow.** Accounts are keyed by a **handle, not an email** — so there is nothing to send a reset link to. Lose your password and the account is unreachable: the remedy is to register a new handle (your published templates keep their slugs per account, so a new handle means re-publishing under the new one). Choose a password you can actually remember.

**🏠 The registry is user-hosted, not a service.** The community registry ships as a Docker image (built and published to GHCR on every release) that **you or someone you trust must run** — any host, any shared URL the apps can be pointed at. There is no managed, hosted PrintNinja registry: the production database (Turso) and the server deployment are manual, the way [REGISTRY.md](./REGISTRY.md) describes. If your registry is down, printing is unaffected — only publishing, browsing and sync wait.

<a id="the-app-itself"></a>

## 📱 The app itself

**🆕 There is no auto-update.** The app checks for a newer release on boot and shows an "Update to vX.Y.Z" badge in the top bar, but clicking it opens the **release page** — you download and install the new version by hand. That is deliberate: there is no update channel to maintain, sign, or be fooled by.

**🧪 There is no app-level (UI) e2e yet.** The e2e suite in the repo is Rust-driven against the **virtual printer** — it proves the pipeline's bytes, states and failure handling end to end, but it does not click through the UI. A Playwright e2e for the app itself is a phase 10 decision, if wanted; UI regressions are caught by the frontend build, type checks and the shared-pipeline tests instead.

**🗣️ The interface is in English and Japanese only.** The UI ships in those two languages, switchable in **Settings → Language**, and no others are available today — adding a language is a translation file under `app/ui/src/lib/i18n/locales/`, no code changes. (Your *prints* are not limited: the renderer carries a Japanese font fallback, so Japanese text in a template renders on the default family, in either interface language.)

[⬅️ Back to the README](../README.md)
