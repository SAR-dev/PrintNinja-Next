# PrintNinja (next)

Greenfield rewrite of PrintNinja, built phase by phase under
[`docs/planned/REFACTORING-PLAN.md`](docs/planned/REFACTORING-PLAN.md).
The current app (`PrintNinja`) keeps shipping; this repo is the rewrite.

**Status: phase 0** — workspace skeleton, CI, test harnesses, design-system
port. No printing yet: the Raw Console (first shippable build) lands in
phase 1.

## Layout

```
core/scene        scene format + data model (phase 4) — depends on nothing
core/render       Rust renderer: text shaping, bitmaps, PDF (phase 5)
core/planner      path selection native | raster | OS print (phase 6)
core/profiles     printer profiles, TOML (phase 2)
core/encoders     one module per printer language (phase 6)
core/transport    bt / usb / tcp / os-print adapters (phase 3)
core/job          job model: states, verification, retry, partial counts (phase 3)
app/              Tauri shell (Windows, Linux) + ui/ frontend (design system ported in phase 0)
tests/golden      golden-byte test harness + committed golden files
tests/e2e/        virtual printer fixture (standalone crate) + e2e tests
```

Dependency rules are in the plan §5.11; the workspace enforces them.

## Requirements

- Rust 1.90.0 (pinned by `rust-toolchain.toml`; rustup installs it automatically)
- Node 22 + pnpm 10 (frontend, `app/ui`)
- Docker (full test suite; the container caps memory so an over-sized
  compile fails fast in the box instead of on the host)

## Quick start

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

## CI

`.github/workflows/ci.yml`: `web-check` (frontend build), `rust-lint`
(fmt + clippy, `-D warnings`), `rust-test-linux` (workspace tests in the
Docker container + fixture tests), `rust-test-windows`. Linux build
dependencies for the Tauri app crate are installed in the CI jobs and in
`tests/Dockerfile.test`.
