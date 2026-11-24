# CI

One workflow, `.github/workflows/ci.yml`, does everything. It runs on pull
requests into `main`, on pushes to `main`, and on pushed `v*` tags. A plain
push to a feature branch runs nothing, so run the same checks yourself (see
[DEVELOPMENT.md](DEVELOPMENT.md)) before you open a pull request.

## What runs when

| Trigger | Jobs |
|---|---|
| Pull request | all push jobs, including `android-check` (PR-only) and `screenshot-matrix` (non-blocking) |
| Push to `main` | the push jobs except `android-check` (PR-only), including `server-publish` |
| Pushed `v*` tag | the push jobs **plus** the tag jobs (`version-check`, `windows-build`, `linux-build`, `android-build`, `github-release`, `server-publish-release`) |

## Push jobs

| Job | Runner | What it does |
|---|---|---|
| `web-check` | ubuntu-latest | Builds the frontend (`app/ui`) and uploads `app/ui/dist` as the `web-dist` artifact |
| `rust-lint` | ubuntu-latest | `cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` |
| `rust-test-linux` | ubuntu-latest | The workspace tests in the Docker test container, then the virtual-printer fixture tests on the host |
| `rust-test-windows` | windows-latest | `cargo test` natively, then the fixture tests |
| `chromium-render` | ubuntu-latest | The document-track e2e through a real system Chrome |
| `android-check` | ubuntu-latest | The Android **debug** build (`--debug --target aarch64 --apk`) on pull requests only |
| `screenshot-matrix` | ubuntu-latest | `pnpm shots` — every screen in both languages, themes and viewports against the fake Tauri bridge, uploaded as the `screenshots` artifact. **Non-blocking** (see below) |
| `rust-check` | ubuntu-latest | Gate job: passes only when every Rust job passed |
| `server-check` | ubuntu-latest | The registry (`pn-server`): fmt, clippy, tests |
| `server-image` | ubuntu-latest | Proves the registry Docker image (`server/Dockerfile`) builds |
| `server-e2e` | ubuntu-latest | The registry image through a full HTTP lifecycle |
| `server-publish` | ubuntu-latest | Pushes the registry image to GHCR (main pushes only) |

### The app jobs need the frontend first

The app crate embeds `app/ui/dist` at compile time
(`tauri::generate_context!`), so `rust-lint`, `rust-test-linux` and
`rust-test-windows` all download the `web-dist` artifact from `web-check`
before touching Rust. The server jobs never compile the app crate and skip
it entirely.

### The Rust tests run in a Docker container, not on the runner

`rust-test-linux` does not `cargo test` on the runner. It runs the workspace
suite inside the test container from `tests/docker-compose.test.yml`
(the same `pnpm test:rust` command you use locally), then runs the
virtual-printer fixture crate on the host. `rust-test-windows` is the native
Windows half. The cap is the point: the container sets
`CARGO_BUILD_JOBS=2` and a 6 GB memory limit, so an over-sized compile
fails fast inside the box instead of wedging the runner, and `target/`
lives in a named volume, so only the first run compiles everything.

`chromium-render` exists because the document track must turn HTML into a
PDF through a real browser — and the Docker test container has no browser
installed (its document-track e2e deliberately proves the honest
no-browser error). This job installs system Chrome with
`browser-actions/setup-chrome` and runs the same e2e for real, with
`PRINTNINJA_BROWSER` pointed at it.

### The Android jobs

`android-check` (pull requests) and `android-build` (release tags) are the
only jobs that compile for Android, so a Rust-or-Kotlin break would
otherwise surface only on a release tag. Both:

- bootstrap Android **cmdline-tools** when the runner has none, then
  install exactly `ndk;27.0.12077973`, `platforms;android-36` and
  `build-tools;34.0.0`;
- pin the generated project to that platform: the Tauri template sets
  `compileSdk`/`targetSdk` to 37, which the stable SDK repository does not
  carry yet, so `scripts/patch-android-sdk.mjs` pins both to 36 (bump the
  platform in the job and in the script together when a newer stable one
  lands);
- silence the expected AGP deprecation warnings
  (`scripts/patch-android-gradle-props.mjs`) and pre-fetch the Gradle
  distribution with retries — the wrapper's single 10-second download
  would otherwise kill the build on one flaky CDN response.

`android-check` stops at the debug APK (no keystore needed).
`android-build` goes further: it applies the generated launcher icons, a
light Android theme and the phone-portrait lock, signs both variants with
the shared keystore from the `ANDROID_KEYSTORE_BASE64` and
`ANDROID_KEYSTORE_PASSWORD` repository secrets (the job fails rather than
ship a throwaway key when they are missing), and uploads
`PrintNinja_<version>_aarch64.apk` + `.aab` to the draft release.

`screenshot-matrix` is the UI screenshot suite
(`scripts/screenshots.mjs`, run it locally as `pnpm shots`): every screen
in both languages, both themes and both viewports (the desktop window and a
Pixel-7-sized phone) rendered against the fake Tauri bridge in headless
Chromium, uploaded as the `screenshots` artifact for a visual eyeball pass.
It is **non-blocking** (`continue-on-error: true`): two android cases — the
new-template dialog — fail today because a recent-jobs row overlaps the
list's footer button on narrow screens. That is an app layout issue the app
redesign (plan phase 11) settles, not a test bug; the job is re-blocked when
the shots are all green again.

### The registry jobs

The community registry is a single Rust binary (`pn-server`) plus a
`server/Dockerfile`. `server-check` is fmt + clippy + `cargo test -p pn-server`.
`server-image` builds the deployable image. `server-e2e` builds the same
image, runs it on a localhost port with a throwaway volume, waits on
`/v1/health`, then runs `server/e2e.py` against it — the full lifecycle an
app uses: account, login, publish, gallery, fetch, save, change feed with
tombstone, unpublish, logout. No runner state survives.

`server-publish` runs on every push to `main` (and needs
`server-image` + `server-e2e` to have passed) and pushes the image to
GHCR as `ghcr.io/<owner>/printninja-server` tagged by short commit sha and
`latest`. It uses the automatic `GITHUB_TOKEN` with the job's
`packages: write` permission.

## Tag jobs (release pipeline)

Pushing a `v*` tag starts the release. `version-check` gates the rest.

| Job | Runner | What it does |
|---|---|---|
| `version-check` | ubuntu-latest | The tag must be strict `vX.Y.Z`, the commit must be on `main`, and the version must match in **all five version carriers** — `package.json`, `app/ui/package.json`, `app/tauri.conf.json`, the workspace version in `Cargo.toml` — **and in every one of the 12 `Cargo.lock` entries** for the workspace members |
| `windows-build` | windows-latest | Builds the MSI installer (`--bundles msi`) |
| `linux-build` | ubuntu-24.04 | Builds the deb and AppImage (`--bundles deb appimage`) |
| `android-build` | ubuntu-latest | The release APK + AAB (arm64-v8a), signed with the shared keystore |
| `github-release` | ubuntu-latest | Collects the installer artifacts into a **draft** GitHub release |
| `server-publish-release` | ubuntu-latest | Tags the registry image with the release version on GHCR |

`github-release` reuses an existing draft and overwrites same-name assets
(`gh release upload --clobber`), so re-running the pipeline after a failed
build does not duplicate assets. The release stays a draft — you publish
it from GitHub.

`server-publish-release` builds the image from `server/Dockerfile` with
OCI source/version/revision labels and pushes
`ghcr.io/sar-dev/printninja-server` tagged with the version (the tag minus
its `v`) and `latest`. It compares the new image's layers plus config
(with the two release-specific labels removed) against `:latest`: if
`server/` is unchanged, it skips the version tag and says so in the job
summary — a missing `:latest` compares unequal, so the check can only ever
skip a redundant tag, never suppress a needed publish. It deliberately
does **not** gate `github-release`: a registry problem must never hold back
the installers, and re-running just this job is safe.

## The gate

`rust-check` is one gate name for branch protection. It runs on
`always()`, needs `rust-lint`, `rust-test-linux`, `rust-test-windows` and
`server-check`, and passes only when all four report `success`. It gates
the installer builds too: `windows-build` needs it (as well as
`web-check`, `rust-test-windows`, `version-check`), and `linux-build` needs
it as well.

## Concurrency, toolchain, versions

- **Concurrency:** `ci-${{ github.ref }}`, with `cancel-in-progress` only
  for non-tag refs. Tag runs are release pipelines — an in-flight one is
  never cancelled.
- **Rust:** pinned to **1.90.0** by `rust-toolchain.toml` locally and by
  `dtolnay/rust-toolchain@1.90.0` in CI (keep the two in sync).
- **Frontend:** Node 22 and **pnpm 12** everywhere (`pnpm/action-setup`
  with `version: 12`).
- **Debug info off in CI:** `CARGO_PROFILE_DEV_DEBUG=0` and
  `CARGO_PROFILE_TEST_DEBUG=0` keep the test binaries small.
- **Version tags:** the tag scheme is date-based, `vYYYY.MMDD.N` — see
  [RELEASE.md](RELEASE.md) for the full story, including the platform
  version overrides the scripts write into `app/tauri.conf.json`.
