# TODO — PrintNinja (next)

Working list. What lands moves to `CHANGELOG.md`; this file tracks what is
not landed yet. Order inside a section is priority order.

## In flight (local only, no network needed)

- [ ] Offline registry verification: `cargo run -p pn-server -- serve` (with
      a temp `PN_SERVER_DB`) + `python server/e2e.py http://127.0.0.1:8787` —
      the full HTTP lifecycle against the real binary, without Docker
- [ ] `graphify update .`
- [ ] Commit the CI-parity work: `ci.yml` (server-check / server-image /
      server-e2e / server-publish), `server/Dockerfile`, `.dockerignore`,
      `server/e2e.py`, the Phase 9 deployable bullet in `REFACTORING-PLAN.md`
      (the CHANGELOG bullet already landed in docs commit `4cbaa2c`)

## Waiting on internet

- [ ] Push `4cbaa2c` (docs) + the CI commit
- [ ] Check CI: `rust-test-windows` green (validates the `.gitattributes` +
      golden fix from `08df762`); the new server jobs green
- [ ] Fix whatever the first server-job run surfaces
- [ ] (Optional) local Docker image verification — the build was killed
      mid-`cargo build` during limited internet; CI's `server-image` +
      `server-e2e` cover the same ground
- [ ] Phase 9 done-mark in `REFACTORING-PLAN.md`

## Phase 10 — release tooling (parity with the old repo)

The new repo has **no release tooling yet**: version is `0.0.0` in every
version carrier, and there is no `scripts/` directory. The old repo has the
full set (`docs/RELEASE.md`): `scripts/release.mjs` (`pnpm release`),
`scripts/set-version.mjs` (`pnpm version:set`), `scripts/release-local.mjs`,
tag-triggered CI builds, local-only signing, and the in-app update badge.
Port all of it:

- [ ] Keep the date-version scheme `YYYY.MMDD.N` (e.g. `2027.0105.0`); the
      first release bumps from `0.0.0`
- [ ] `scripts/release.mjs` + `pnpm release`: next free date version (read
      `vYYYY.MMDD.*` tags locally and on `origin`), update every version
      carrier — workspace `Cargo.toml`, `Cargo.lock`, `app/tauri.conf.json`,
      `app/ui/package.json`, plus `bundle.windows.wix.version`
      (`YY.MM.(DD*100+N)`, the MSI first-field ≤ 255 limit) — commit
      `release: vX.Y.Z`, annotated tag `vX.Y.Z`. Guards: on `main`, clean
      tree, not behind `origin`, version higher than current, tag free.
      Flags: `--dry-run`, `--push`, `--label major|hotfix`, exact-version
      override
- [ ] `scripts/set-version.mjs` + `pnpm version:set` — bring out-of-sync
      version carriers back in line (edit only, no commit/tag/push)
- [ ] `scripts/release-local.mjs` — the local release script: checks, bump,
      tag, then build what the host OS allows (Windows: MSI, Linux:
      deb/AppImage), push, create/update the draft GitHub release via `gh`.
      Each machine builds what it can; the draft collects everything
- [ ] Tag-triggered CI jobs (`v*` push): `version-check`, `windows-build`
      (MSI), `linux-build` (deb + AppImage), `github-release` (draft release
      collecting the build artifacts). `server-publish` gains the
      release-version tag alongside the current sha/`latest` tags
- [ ] In-app update check: on boot compare the app version with the latest
      GitHub Release, show an "Update vX.Y.Z" badge linking to the release
      page. No auto-update path to maintain
- [ ] MSI signing stays local-only (`signtool` + `scripts/certs/windows.pfx`,
      never committed); `release-local` builds unsigned
- [ ] Hardware verification per profile: run the checklist, mark profiles
      `verified` as they pass; failure drills (paper out, cover open,
      cable/Bluetooth drop mid-job, wrong mode, printer paused); performance
      checks (Bluetooth bytes + transfer time, start-to-result latency)
- [ ] app-e2e (parity with the old repo): the old suite is ~20 Playwright
      specs driven by a Vite-served app + service + virtual printer —
      sign-in/auth, password change, community gallery, offline mode,
      library, the print flow through a virtual printer, designer
      validation, deep links, a11y/i18n, mobile viewports, desktop
      screenshot baselines (regenerated via `E2E_UPDATE_SNAPSHOTS` in the
      CI environment, where fonts matter). The new repo has **no
      UI-level e2e at all** (`tests/e2e/` is the Rust virtual-printer
      fixture). Decide first how Playwright drives a Tauri app here:
      the real webview via tauri-driver, or the web UI with a stubbed
      Tauri bridge. Then port the spec set and add the `app-e2e` CI job
- [ ] Release candidate cut — the phase exit

## Phase 11 — Android

- [ ] Android transport adapters (Bluetooth, USB, network, print service
      where a driver exists) and packaging; shared renderer/planner/profiles/
      encoders unchanged
- [ ] Background print service: third-party apps submit jobs, PrintNinja
      renders, plans and delivers
- [ ] Labels only, permanently — the document track and headless browser
      are desktop-only

## Deferred (documented, not scheduled)

- [ ] TLS for the transports and the registry (`ipps://`, `https://`)
- [ ] Registry extras: callbacks, Prometheus metrics, OpenAPI doc
- [ ] Document track: richer CSS designer toolbar
- [ ] History: filters, batch reprint, CSV export
- [ ] Deep links: trusted-source management
- [ ] Production registry deploy on Turso (user deploys; SQL stays portable)
