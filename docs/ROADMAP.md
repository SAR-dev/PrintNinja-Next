# Roadmap

The remaining work of the rewrite, as a checklist. Phases 0–9 are done —
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
- [ ] **App redesign** (owner) — includes the phone layout overlap where
      a recent-jobs row covers the list's "New template" footer button on
      narrow screens (it is why the two android `new-template` screenshot
      cases fail). When the screenshot matrix is all green again, remove
      `continue-on-error` from the `screenshot-matrix` CI job to re-block
      it.

**Permanent constraints, not tasks:** Android prints thermal media via the
scene track only — no html document track, no headless browser on mobile.
macOS is out of scope permanently.

**Exit:** Android prints a batch of labels with per-label data (and a
variable-length receipt), including one submitted by a third-party app
through the background service.

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
