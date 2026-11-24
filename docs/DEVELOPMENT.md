# Development

> **Who this is for:** people who want to build, run, or change
> PrintNinja (next) itself.
> **What you will know after reading:** how to set up the environment, what
> lives where, the dev loop, the checks and test gate you must pass, how to
> run the registry server locally, and how releases ship.

## Prerequisites

- **Node 22** — the `engines` fields pin `22.x`
- **pnpm** — CI runs pnpm 12; use that version locally
- **Rust 1.90.0** — pinned in `rust-toolchain.toml`; rustup installs it
  automatically the first time you run a cargo command
- **Docker** — the full Rust test suite runs in a Linux test container even
  on Windows (Docker Desktop works)

```bash
git clone <this repo>
cd printninja-next
pnpm install          # root: Tauri CLI + release scripts
pnpm -C app/ui install   # the frontend is its own pnpm project
```

## The pnpm projects

There is **no root workspace file**. The repo holds three separate pnpm
projects, each with the lockfile it needs:

| Project | What it is |
|---|---|
| root `package.json` | The Tauri CLI (`@tauri-apps/cli`, a devDependency) and the release/test scripts |
| `app/package.json` | A thin passthrough: `dev`/`build` forward to `ui/` |
| `app/ui/package.json` | The React frontend (Vite, Tailwind, shadcn/ui), with its **own `pnpm-lock.yaml`** |

The Rust side is one cargo workspace with 12 members — `app`, the eight
`core/*` crates, `server`, `tests/golden` and `tests/e2e`. The
virtual-printer fixture (`tests/e2e/support/virtual-printer`) is
deliberately excluded from the workspace: it is a standalone std-only crate
with its own `Cargo.lock`, compiled on demand and spawned as a subprocess
by the e2e tests.

## The dev loop

```bash
pnpm tauri:dev
```

Run it from the repo root. The Tauri CLI lives in the root project, not in
`app/`, so every tauri script carries `--config app/tauri.conf.json`. The
command starts the UI dev server (Vite, on `http://localhost:1420`, strict
port) and the Tauri shell around it.

One gotcha: the app crate embeds `app/ui/dist` at compile time
(`tauri::generate_context!`). `tauri:dev` starts the dev server instead,
but **any Rust build or test needs the frontend built first**:

```bash
pnpm -C app/ui install
pnpm -C app/ui build     # -> app/ui/dist
```

## The check set

These are the same checks the release script and CI run (minus the
other-OS jobs):

```bash
pnpm --dir app/ui lint     # biome check
pnpm --dir app/ui build    # tsc -b && vite build
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

Run them before you push — see [CI.md](CI.md) for what CI adds on top.

## The test gate: Rust tests in Docker

```bash
pnpm test:rust              # full suite in the Docker test container
pnpm test:rust:report       # same, writing a JUnit report to test-report/junit.xml
```

**Never a bare `cargo test` for the full suite natively.** The desktop
crate compiles heavy debug binaries and a parallel native build can peak at
several gigabytes. `pnpm test:rust` runs the suite in the container from
`tests/docker-compose.test.yml` (mirroring CI's `rust-test-linux`), where
`CARGO_BUILD_JOBS` is capped at 2 and the container at 6 GB — an over-sized
compile fails fast inside the box instead of pressuring the machine. The
workspace is mounted at `/workspace`, so tests always run against the
current checkout, and `target/` lives in a named volume, so only the first
run compiles everything; later runs recompile just what changed.

The fixture crate builds in a fraction of a second and runs anywhere:

```bash
pnpm test:virtual-printer
# = cargo test --manifest-path tests/e2e/support/virtual-printer/Cargo.toml
```

## Golden tests

`tests/golden` is a golden-byte harness with committed golden files
(`tests/golden/cases/`). It runs as part of the workspace suite
(`pnpm test:rust`), and it also runs natively:

```bash
cargo test -p golden-harness           # normal run: compare against the goldens
GOLDEN_UPDATE=1 cargo test -p golden-harness   # regenerate the goldens
```

Only regenerate after confirming the change in the output is intended.

## Run the registry server locally

The registry (`pn-server`) is one binary with a SQLite file — no other
services. Two ways to run it:

```bash
# From the workspace (listens on 127.0.0.1:8787 by default):
cargo run -p pn-server -- serve

# Or the deployable image:
docker build -f server/Dockerfile -t printninja-server .
docker run -d --name printninja-server -p 8787:8787 -v registry-data:/data printninja-server
```

Database commands work from the shell (and inside a running container):

```bash
cargo run -p pn-server -- migrate status
cargo run -p pn-server -- migrate make add_the_thing
cargo run -p pn-server -- migrate apply
cargo run -p pn-server -- db reset    # ⚠️ deletes the data; stop the server first
```

Once it is up, run the HTTP end-to-end against any running server —
stdlib Python only, no dependencies:

```bash
python3 server/e2e.py http://127.0.0.1:8787
```

It walks the full lifecycle an app uses: health, account, login, publish
(create + update), public gallery search, fetch, save, change feed,
unpublish with tombstone, logout. A failed step prints the offending
request and exits non-zero. Full hosting guide: [REGISTRY.md](REGISTRY.md).

## Releasing

```bash
pnpm release            # date version (YYYY.MMDD.N), commit, tag; --label, --push, --dry-run
pnpm version:set        # set an exact version in every manifest + Cargo.lock
node scripts/release-local.mjs   # the whole pipeline on this machine: bump, check, build
```

`release-local.mjs` runs the same check set as above plus `pnpm test:rust`,
builds whatever this OS allows (Windows: MSI; Linux: deb + AppImage), and
with `--push` pushes `main` + the tag and updates the draft release.
Pushing a `v*` tag also starts the hosted release in CI. The tag scheme,
the platform version overrides, and every flag are documented in
[RELEASE.md](RELEASE.md).
