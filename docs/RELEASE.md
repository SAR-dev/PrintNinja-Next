# Release Guide — PrintNinja

How to version, sign, and ship a new PrintNinja release, and what a pushed
`v*` tag does in CI.

## Prerequisites

- **Windows**: Rust 1.90.0 (pinned in `rust-toolchain.toml`), Node 22 (see
  `engines` in `package.json`), Visual Studio Build Tools (MSVC), `pnpm`
- **Linux** (deb/AppImage builds): the webkit2gtk dev packages (the
  `linux-build` job in CI lists them)
- **Every machine**: Docker (the Rust test gate `pnpm test:rust` runs in the
  Linux test container even on Windows) and `gh` authed with repo scope
- For signing locally: a Windows code-signing certificate (`.pfx`)

## 1. Set the version and tag

Versions come from the date, so you never type one. Run this from a clean
`main` that is up to date with `origin`:

```bash
pnpm release                      # next date version, e.g. 2026.1124.0
pnpm release --label hotfix       # same, and note "hotfix" in the tag and commit
pnpm release --dry-run            # show what would happen, change nothing
pnpm release --push               # also push main + the tag (tag only, no builds)
pnpm release 5.1.3                # emergency override: exact X.Y.Z, must be higher than the current one
```

Releases ship from `main` (the scripts refuse any other branch); feature
work lands on `develop` and merges to `main` first.

### The version format: `YYYY.MMDD.N`

| Release | Version |
| --- | --- |
| first on 24 Nov 2026 | `2026.1124.0` |
| second on 24 Nov 2026 | `2026.1124.1` |
| first on 5 Jan 2027 | `2027.105.0` |

- `MMDD` is a plain number, so months 1 to 9 have no leading zero (`105`, not `0105`).
  Semver and Cargo reject leading zeros.
- `N` counts that day's releases, starting at 0. The script reads the existing
  `v2026.1124.*` tags locally **and on `origin`** and takes the next free number,
  so two people releasing on the same day do not collide. If `origin` cannot be
  reached it warns and uses local tags only. There is room for 100 releases per
  day (`N` is 0 to 99).
- The date is your machine's local date at the moment you run the command.
- The tag is `v` + the version (`v2026.1124.0`), which is what CI expects.
- There is no major/minor/patch any more. To mark a big release, add
  `--label major`: the label goes into the tag message and the commit (and the
  draft release title with `release-local`), never into the version number.
- `patch`, `minor`, `major` and the `release:patch/minor/major` shortcuts are
  gone; the script refuses them with a hint.

### Platform overrides (written automatically)

Two platforms cannot use a bare date version, so a date version also writes two
values into `app/tauri.conf.json`. You do not edit them by hand;
`release.mjs`, `release-local.mjs` and `set-version.mjs` keep them in step and
remove them again for a non-date version.

| Platform | Problem | Override | Example for `2026.1124.3` |
| --- | --- | --- | --- |
| Windows MSI | first number is limited to 255 | `bundle.windows.wix.version` = `YY.MM.(DD*100+N)` | `26.11.2403` |
| Android | Tauri's default `versionCode` goes down across New Year, and Android rejects downgrades | `bundle.android.versionCode` = `YYMMDD*100+N` | `26112403` |

Android is bundled now (debug APK on pull requests via `android-check`,
signed APK + AAB on release tags via `android-build`); the `versionCode`
above is the one those builds use.

`pnpm release 2026.5.0` (a number that is neither a date version nor
MSI-safe) is refused.

### What gets updated

The script (`scripts/release.mjs`, needs only Node and git) updates these five
places:

- `package.json` (root)
- `app/ui/package.json`
- `app/tauri.conf.json` (version and the platform overrides above)
- `Cargo.toml` (`[workspace.package]` version; the `[workspace.dependencies]`
  versions are left alone)
- `Cargo.lock` (every workspace member: `printninja`, `pn-scene`, `pn-browser`,
  `pn-render`, `pn-planner`, `pn-profiles`, `pn-encoders`, `pn-transport`,
  `pn-job`, `pn-server`, `golden-harness`, `pn-e2e`)

Then it commits `release: vX.Y.Z` and creates an annotated tag `vX.Y.Z`. It
refuses to run if:

- you are not on `main` (cut tags from `main`),
- the working tree is not clean,
- the new version is not higher than the current one, or the tag already exists
  (locally or on `origin`),
- the five files above do not all agree on the current version.

Without `--push` nothing leaves your machine, and you finish with
`git push --atomic origin main vX.Y.Z`. To undo an unpushed release:
`git tag -d vX.Y.Z && git reset --hard HEAD~1`.

### Fixing out-of-sync versions

If `pnpm release` stops with `versions are out of sync before bumping`, the
files above disagree about the current version (a file shown as
`(not found)` means its version could not be read). Bring them back in line
with:

```bash
pnpm version:set 2026.1124.0           # set all files to this version
pnpm version:set 2026.1124.0 --dry-run # show which files would change, change nothing
```

`scripts/set-version.mjs` only edits the files. It does not commit, tag or
push, and it does not run the release checks. Set it to the **current**
version you want to release from, then run `pnpm release` as usual. Do not set
the new version first and then run `pnpm release` with the same number: the
release script requires the new version to be higher than the current one.
Review the result with `git diff` before you release, because the release
script refuses a dirty working tree, so commit the change first.

## 2. Sign the app locally (for now)

### Windows (MSI)

Store your certificate as `scripts/certs/windows.pfx` (not committed).

```powershell
# Build MSI only
pnpm tauri:build --bundles msi

# Optional: sign the resulting MSI with signtool
signtool sign /f ./scripts/certs/windows.pfx /p password /tr http://timestamp.digicert.com /td sha256 /fd sha256 target/release/bundle/msi/*.msi
```

Artifacts land in the workspace `target/` directory
(`target/release/bundle/{msi,deb,appimage}/`), because the Tauri build runs
from the repo root against `app/tauri.conf.json`.

## 3. Signing is local-only

Nothing signs automatically. `release-local.mjs` builds **unsigned** desktop
installers. Sign the MSI yourself if you want (section 2) and replace the file
on the draft release.

## 4. Build and publish the release

There are two ways to ship. Pushing a `v*` tag runs the hosted workflow
(`.github/workflows/ci.yml`), which builds the MSI, deb and AppImage and
attaches them to a draft GitHub release, and publishes the server image to
GHCR (section 6). The manual route is one script that runs the checks, bumps
the version, commits and tags, builds what the host OS allows and updates the
draft GitHub release. Each machine builds what it can (Windows: MSI; Linux:
deb/AppImage); run it on each OS and the draft collects everything.

```bash
node scripts/release-local.mjs                  # next date version; everything but push + release
node scripts/release-local.mjs --push           # + push main/tag, create/update the draft
node scripts/release-local.mjs --label hotfix --push        # note it in the tag, commit and draft title
node scripts/release-local.mjs --push --skip-checks         # iterating on build issues
node scripts/release-local.mjs 2026.1124.0 --push           # explicit version (same rules as before)
```

Requirements: Node 22, pnpm, Rust 1.90, Docker (the `pnpm test:rust` gate),
`gh` authed with repo scope.

What the script checks before building: you are on `main` with a clean tree,
the new version is higher than the current one, the tag does not exist locally
or on `origin`, and every version carrier (`package.json`,
`app/ui/package.json`, `app/tauri.conf.json`, `Cargo.toml`, `Cargo.lock`)
agrees on the current version. Then it runs the checks the CI runs, minus the
other-OS jobs: `pnpm install --frozen-lockfile` (both pnpm projects), the UI
lint + build, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`
and the full Rust suite in the Docker test container (`pnpm test:rust`).

`pnpm release` (section 1) is only needed if you want to set the version and
tag without building. With no version argument the script picks the date
version itself, exactly like `pnpm release`, so every run without a version
starts a **new** release (the next `N`). If you build one release on several
machines, give each machine the same explicit version (for example
`node scripts/release-local.mjs 2026.1124.0`), as you would have with a
hand-typed version before.

## 5. Publish

Open the draft release on GitHub. If you sign locally, replace the unsigned
files with your signed builds, then publish.

The app surfaces new releases itself: on boot it compares its version with the
latest GitHub Release of `SAR-dev/PrintNinja-Next` and shows an "Update
vX.Y.Z" badge in the top bar linking to the release page, where users download
and update by hand. There is no auto-update path to maintain. (The badge
follows `VITE_UPDATE_API` / `VITE_UPDATE_REPO` for self-hosted forges.)

## 6. The server image (Docker on GHCR)

The community registry (`pn-server`, `server/`) is published as a Docker image
on every `v*` tag by the `server-publish-release` job. Nothing else is needed
from you: it logs in with the automatic `GITHUB_TOKEN`, so there is no secret
to store.

| Image | Tags |
|---|---|
| `ghcr.io/sar-dev/printninja-server` | the release version without the `v` (for example `2026.1124.0`), and `latest` |

What to know:

- The job waits for `server-check`, `server-image`, `server-e2e` and
  `version-check`, so a broken server is never published.
- If the built image has the same content as the current `:latest` (same
  layers and config, ignoring the per-release version/revision labels), the
  job skips the push: an app-only release no longer creates a misleading new
  server tag. The job summary says so. A missing `:latest` or any uncertainty
  publishes as before.
- It does **not** block `github-release`, on purpose: a registry problem must
  never hold back the installers. If the push fails, the installers still
  ship; fix the cause and re-run only the `server-publish-release` job (the
  same tags are overwritten).
- The image is tagged with the same date version as the app, so you can match
  a server image to an app release.
- Hosting one yourself — including the production database on Turso Cloud
  (the store's SQL stays portable) — is in `docs/REGISTRY.md`.

### First release only: make the package public

GHCR packages start **private**, so `docker pull` fails for everyone else
until you change that once. After the first tagged run, on GitHub open your
profile or organisation → **Packages** → `printninja-server` → **Package
settings** → **Change visibility** → **Public**. Later releases keep the
setting.

### Share it without a registry

If you cannot use GHCR (private network, no internet), build and export the
image by hand and send the file:

```bash
docker build -f server/Dockerfile -t printninja-server:2026.1124.0 .
docker save printninja-server:2026.1124.0 | gzip > printninja-server-2026.1124.0.tar.gz
# on the other machine:
gunzip -c printninja-server-2026.1124.0.tar.gz | docker load
```

## Clean up cache

```bash
cargo clean
pnpm store prune
```
