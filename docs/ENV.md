# Environment variables — PrintNinja

Every variable the code actually reads, in one place. If a variable is not
listed here, the code does not read it. Defaults are the values you get when
the variable is unset.

Jump to: 🌍 [Registry server](#-registry-server) · 💻 [App runtime](#-app-runtime) ·
🎨 [App UI (build time)](#-app-ui-build-time) · 🧪 [Test tooling](#-test-tooling) ·
🚀 [Release & CI scripts](#-release--ci-scripts)

## 🌍 Registry server

`pn-server` (`server/`) reads exactly three variables and nothing else —
no database URL, no auth token, no CORS switch. Everything else is a
command-line argument or a file.

| Variable | Where read | What it does | Default |
|---|---|---|---|
| `PN_SERVER_BIND` | `server/src/config.rs` | The address the server listens on (`host:port`). | `127.0.0.1:8787` — local only; the Docker image sets `0.0.0.0:8787` |
| `PN_SERVER_DB` | `server/src/config.rs` | Path of the server's SQLite file. | `printninja-server.db` in the current directory; the image sets `/data/printninja-server.db` |
| `PN_SERVER_MIGRATIONS_DIR` | `server/src/migrate.rs` | Where `migrate make` looks for / writes `NNNN_name.sql` files. | `./migrations`, then `./server/migrations` relative to the working directory; the image sets `/app/migrations` |

The Dockerfile pins all three (`server/Dockerfile`), so a plain
`docker run` of the GHCR image needs none of them. For a shared server
the SQL is kept portable on purpose — see `docs/REGISTRY.md`.

## 💻 App runtime

The desktop app reads these while it runs. None of them is required for
normal use.

| Variable | Where read | What it does | Default |
|---|---|---|---|
| `PN_PROFILES_DIR` | `app/src/lib.rs` | A directory of printer-profile TOML files, replacing the shipped set. Useful for testing a new profile without touching `core/profiles/profiles/`. | the shipped profiles in `core/profiles/profiles/` |
| `PN_REGISTRY_URL` | `app/src/registry.rs` | The registry server's base URL. Wins over the *Server address* setting; both fall back to the default. | `http://127.0.0.1:8787` |
| `PRINTNINJA_BROWSER` | `core/browser/src/lib.rs` | Path to the headless browser binary used to render document-track templates to PDF. | the OS's own browser (Edge on Windows, Chromium/Chrome on Linux) |

`PRINTNINJA_BROWSER` is how a machine without a standard browser install
still renders documents, and how tests pin a specific binary.

## 🎨 App UI (build time)

The UI is a Vite app, so these are read by `app/ui` at **build time** and
baked into the bundle. Changing them means rebuilding the UI (and then,
for the desktop app, rebuilding the app around it).

| Variable | Where read | What it does | Default |
|---|---|---|---|
| `VITE_UPDATE_REPO` | `app/ui/src/lib/appUpdate.ts` | The repository the update badge checks for the latest release. | `SAR-dev/PrintNinja-Next` |
| `VITE_UPDATE_API` | `app/ui/src/lib/appUpdate.ts` | The API base used for that check. | `https://api.github.com` |

For a self-hosted forge (Gitea, GitLab, …) point both at your server and
rebuild — the badge has no way to reach a URL that was not baked in. The
badge is read-only: it only links to the release page, nothing is
auto-downloaded.

## 🧪 Test tooling

| Variable | Where read | What it does | Default |
|---|---|---|---|
| `GOLDEN_UPDATE` | `tests/golden/src/lib.rs` | When **set** (any value), `cargo test` regenerates the golden files under `tests/golden/cases/` instead of comparing against them. Use only after confirming a byte-level change is intended. | unset: tests compare and fail on a difference |
| `CARGO_BUILD_JOBS` | set by `tests/docker-compose.test.yml` | Build parallelism inside the Rust test container, fixed at `2` together with a 6 GB memory cap. Do not raise it: an over-sized compile is supposed to fail *inside the box*. | `2` (compose, not your shell) |

Regenerate and re-run:

```bash
GOLDEN_UPDATE=1 pnpm test:rust          # or: GOLDEN_UPDATE=1 cargo test -p golden-harness
```

Two things that are **not** environment variables:

- The server's end-to-end script takes its base URL as an argument:
  `python3 server/e2e.py http://127.0.0.1:8787`.
- The Rust suite itself is driven by `pnpm test:rust` (Docker compose);
  it reads no extra variables.

## 🚀 Release & CI scripts

The release scripts (`scripts/release.mjs`, `scripts/set-version.mjs`,
`scripts/release-local.mjs`) read **no** environment variables — all
their inputs are flags and arguments, and everything else comes from
git. `TAURI_SIGNING_PRIVATE_KEY` is *not* needed either: the app has no
auto-updater, only the release-page badge (see `docs/RELEASE.md` and
`docs/SIGNING.md`).

One exception, and it is **work in progress — uncommitted on this
branch** as the Android app work is wired up:

| Variable | Where read | What it does | Default |
|---|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | `scripts/patch-android-signing.mjs` | The base64 of the Android `.keystore`, stored as a CI secret and used to pin the release builds to one stable key. The script fails loudly when it is missing. | none — required |
| `ANDROID_KEYSTORE_PASSWORD` | `scripts/patch-android-signing.mjs` | The keystore password (CI secret). | none — required |
| `ANDROID_KEYSTORE_ALIAS` | `scripts/patch-android-signing.mjs` | The key alias inside the keystore. | `printninja` |

Until the Android app lands, none of these is used by any committed
CI job.
