# 💙 Contributing to PrintNinja

Thank you for wanting to help! 🎉 PrintNinja gets better because people use it, break it, question it and improve it.

**You do not need to write code to contribute.** Reporting a problem, sharing an idea, testing on your own printer or fixing a confusing sentence in the docs all make a real difference.

**Jump to:**
[🙋 Ways to help](#-ways-to-help) ·
[🧰 Setup](#-setup) ·
[🔀 Branch model](#-branch-model) ·
[✅ The verification loop](#-the-verification-loop) ·
[📝 Commit style](#-commit-style) ·
[📬 Pull requests](#-pull-requests) ·
[🕸️ The graphify rule](#-the-graphify-rule) ·
[📚 Docs](#-docs) ·
[🚢 Releasing](#-releasing)

---

## 🙋 Ways to help

- 🐛 **Report a problem.** Open an issue with what you did, what you expected, what happened, your OS, the app version (shown next to the name in the top bar) and the printer model. Check [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) and [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) first — your answer may already be there.
- 🖨️ **Test on real hardware.** Every bundled printer profile is `untested` until someone prints on the real device. A short report of what worked and what did not (model, transport, media, result word) is very valuable.
- 🌍 **Improve translations.** The app ships English and Japanese; wording fixes in either are welcome.
- ✏️ **Fix the docs.** Typos, unclear steps and out-of-date screenshots count as contributions.
- 💻 **Fix a bug or build a feature.** For anything big, open an issue first so we can agree on the approach before you invest the time.

## 🧰 Setup

You need:

- **Rust 1.90.0** — pinned in `rust-toolchain.toml`; rustup installs it on first use
- **Node 22** and **pnpm**
- **Docker** — only for the full Rust test suite

```bash
git clone https://github.com/SAR-dev/PrintNinja-Next.git
cd PrintNinja-Next
git checkout develop
pnpm install                                     # root: Tauri CLI and release scripts
pnpm -C app/ui install && pnpm -C app/ui build   # the app embeds the UI at compile time
pnpm tauri:dev                                   # run the app
```

The repo holds separate pnpm projects (root and `app/ui`), so install in both. Full details on the toolchain, the dev loop, the golden tests and running the registry locally are in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

No printer? Use the virtual-printer fixture as a print target; `pnpm test:virtual-printer` runs its own tests (small, std-only, fine to run natively).

## 🔀 Branch model

- `develop` is the integration branch: feature work lands here, and pull requests are opened against it.
- `main` is the release branch: releases ship from `main` only — the release scripts refuse any other branch. Feature work merges to `main` before it ships.
- Create your branch from `develop`, for example `fix/spooler-close-delay` or `feat/receipt-footer`.
- Keep commits small and focused: one change per commit, with a regression test for every bug fix. 🛡️

## ✅ The verification loop

Run the checks that match what you changed **before you push**. CI runs the same set, so a green local run means a green pull request.

| Area | Commands |
|---|---|
| Rust format | `cargo fmt --check` |
| Rust lint | `cargo clippy --all-targets -- -D warnings` |
| Full Rust suite | `pnpm test:rust` — Docker only, see below 🐳 |
| UI | `pnpm --dir app/ui lint` and `pnpm --dir app/ui build` |
| UI, visual changes | `pnpm shots` and look at the result (first run: `pnpm exec playwright install chromium`) |
| Printer encoders / output | `cargo test -p golden-harness` — regenerate goldens with `GOLDEN_UPDATE=1` **only** when the new output is the intended change |

**🐳 The full Rust suite runs in Docker, never bare `cargo test` natively.** `pnpm test:rust` runs the workspace tests in a Linux container (`tests/docker-compose.test.yml`): the desktop crate's debug build peaks at several gigabytes natively, while the container caps `CARGO_BUILD_JOBS` at 2 and memory at 6 GB, so an over-sized run fails fast inside the box instead of on your machine. `target/` lives in a named volume, so only the first run compiles everything. `pnpm test:rust:report` additionally writes a JUnit report.

One gotcha: the app crate embeds `app/ui/dist` at compile time (`tauri::generate_context!`), so after touching the frontend, run `pnpm --dir app/ui build` before any Rust build or test.

### Before you commit — checklist

1. `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` pass.
2. `pnpm test:rust` passes (for Rust or app changes).
3. `pnpm --dir app/ui lint` and `pnpm --dir app/ui build` pass (for UI changes).
4. A bullet is added under **Unreleased** in [`CHANGELOG.md`](CHANGELOG.md).
5. The matching guide in `docs/` is updated if people will see or do something differently.
6. `graphify update .` has been run (see below).
7. New user-facing text has **both** English and Japanese strings.

## 📝 Commit style

- **One-line commit messages** — no body, no `Co-Authored-By` or other trailer lines.
- Use a short type with an optional scope, in the imperative (e.g. `feat: …`, `fix(print): …`): `fix(print): honor the close delay on the spooler path`.
- Types used in this repo: `feat`, `fix`, `docs`, plus `chore`, `test`, `refactor` and `ci` when they fit.

## 📬 Pull requests

1. Open the pull request against `develop`.
2. Describe what changed and why, and link the issue if there is one. For UI changes, include before/after screenshots.
3. List which checks from the loop above you ran.
4. Keep it focused — unrelated cleanups belong in their own pull request.
5. Be ready to iterate: review comments are about the code, not about you. 💙

## 🕸️ The graphify rule

This project has a knowledge graph in `graphify-out/`.

- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- `graphify-out/graph.json` is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild.
- Never commit the generated `screenshots/` folder; it is gitignored on purpose.

## 📚 Docs

The guides live in [`docs/`](docs/), in the same friendly, plain-English, tasteful-emoji tone as this file. When your change alters what people see or do, update the matching guide in the same change. When the UI changes noticeably, refresh the curated images in [`assets/`](assets/) from a fresh `pnpm shots` run. ✏️

## 🚢 Releasing

Releases are maintained by the project owners. They are date-versioned (`YYYY.MMDD.N`, for example `2026.1124.0`, then `2026.1124.1` for a second release the same day) and ship from `main`.

```bash
pnpm release                                       # next date version; commits and tags
node scripts/release-local.mjs <version> --push    # build installers locally, attach to a draft release
```

- **Never edit version numbers by hand.** The version lives in five places (`package.json`, `app/ui/package.json`, `app/tauri.conf.json`, the workspace `Cargo.toml`, and every member entry in `Cargo.lock`). Use `pnpm version:set <version>`, which keeps them in sync.
- Commit manifests and lockfiles **together**, or `pnpm install --frozen-lockfile` and the CI Android build break.

Pushing the `v*` tag triggers the CI tag jobs: version check, MSI (Windows) and deb + AppImage (Linux) builds, a draft GitHub release, and the registry image on GHCR. Full guide: [`docs/RELEASE.md`](docs/RELEASE.md).

---

Thank you again for helping make PrintNinja better. 💙
