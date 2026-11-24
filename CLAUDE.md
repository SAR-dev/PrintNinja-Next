# Working rules for this repo

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## Commits

- **One-line commit messages, always** — no body, no bullet points, no
  `Co-Authored-By` lines.

## Running tests locally (Docker, not native)

- Rust tests: `pnpm test:rust` (compose: `tests/docker-compose.test.yml`).
  Never a bare native `cargo test` for the full suite: the app crate's debug
  build peaks at several gigabytes natively, while the container caps
  `CARGO_BUILD_JOBS` at 2 and memory at 6 GB (an over-sized run fails fast
  inside the box) and keeps `target/` in a named volume, so only the first
  run compiles everything. `pnpm test:rust:report` additionally writes a
  JUnit report.
- The virtual printer fixture is small and std-only; running it natively is
  fine: `cargo test --manifest-path tests/e2e/support/virtual-printer/Cargo.toml`.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` are
  fine natively (check-only, low memory).
- The app crate embeds `app/ui/dist` at compile time
  (`tauri::generate_context!`). Build the frontend first
  (`pnpm -C app/ui install && pnpm -C app/ui build`) or every Rust
  build/test of the app crate fails.

## The verification loop (house style)

Before committing a Rust or app change:

1. `cargo fmt --check`
2. `cargo clippy --all-targets -- -D warnings`
3. `pnpm test:rust` (the Docker gate above — never a native full suite)
4. For UI changes: `pnpm --dir app/ui lint` (biome) and
   `pnpm --dir app/ui build`
5. Add a bullet to the Unreleased section of `CHANGELOG.md`
6. Commit (one-line message, see Commits) and push

## Versioning

- The version lives in **five carriers**: `package.json`,
  `app/ui/package.json`, `app/tauri.conf.json`, the workspace version in
  `Cargo.toml`, and **all 12 member entries in `Cargo.lock`**. Never edit
  them by hand — run `pnpm version:set <version>` (it syncs all five).
- Release versions are date-based (`YYYY.MMDD.N`). For those, the script
  additionally writes `bundle.windows.wix.version` and
  `bundle.android.versionCode` into `app/tauri.conf.json`; for any other
  version it removes both.
- Tauri's Android build **rejects version `0.0.0`** — the repo version
  must be at least `0.0.1` or the `android-check` job fails on every PR.
- **Commit manifests and lockfiles together.** Committing
  `package.json`/`Cargo.toml` without the matching `pnpm-lock.yaml`/
  `Cargo.lock` breaks `pnpm install --frozen-lockfile` and the CI Android
  build.

## Screenshots

- `pnpm shots` renders every screen against the fake Tauri bridge
  (`e2e/support/fakeAgent/`) in both languages, both themes and both
  viewports (desktop window + Pixel-7-sized phone), writing PNGs plus a
  contact sheet (`index.html`) per platform into `screenshots/`
  (**gitignored — never commit it**). First run needs
  `pnpm exec playwright install chromium`.
- CI runs the matrix as the blocking `screenshot-matrix` job and uploads
  the shots as the `screenshots` artifact. It must install the `app/ui`
  pnpm project too (`pnpm --dir app/ui install --frozen-lockfile`) — the
  script boots `app/ui`'s vite straight from its `node_modules`, which a
  root-only install never creates.
- The curated README images are committed under `assets/`. Refresh them
  from a fresh `screenshots/` run when the UI changes.

## Android

- Android builds are **CI-only** on this machine: `android-check` (debug
  APK on every PR) and `android-build` (signed APK + AAB on `v*` tags).
  Both pin the generated project to the newest *stable* Android platform
  (currently 36) via `scripts/patch-android-sdk.mjs` — the Tauri template
  asks for 37, which the stable SDK repository does not carry yet. Bump
  the platform in the job and the script together.
- `android-build` signs with the repo secrets
  `ANDROID_KEYSTORE_BASE64` + `ANDROID_KEYSTORE_PASSWORD` and fails rather
  than ship a throwaway key when they are missing.
- The app-level Android work (transport adapters, background print
  service) is still to build; CI already compiles and bundles the app.

## The roadmap

`docs/ROADMAP.md` is the remaining-work checklist, in priority order:
hardening, hardware verification, the first release candidate, and the
Android app.
The architecture rationale lives in `docs/ARCHITECTURE.md`. Check the
roadmap before hardware or platform work.
