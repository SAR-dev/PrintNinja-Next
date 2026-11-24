# 💙 Contributing to PrintNinja (next)

Thank you for wanting to help! 🎉 PrintNinja gets better because people use it, break it, question it and improve it.

**You do not need to write code to contribute.** Reporting a problem, sharing an idea, testing on your own printer or fixing a confusing sentence in the docs all make a real difference.

**Jump to:**
[🔀 Branch model](#-branch-model) ·
[✅ The verification loop](#-the-verification-loop) ·
[📝 Commit style](#-commit-style) ·
[🕸️ The graphify rule](#-the-graphify-rule) ·
[📚 Docs](#-docs) ·
[🚢 Releasing](#-releasing)

---

## 🔀 Branch model

- `develop` is the integration branch: feature work lands here, and pull requests are opened against it.
- `main` is the release branch: releases ship from `main` only — the release scripts refuse any other branch. Feature work merges to `main` before it ships.
- Keep commits small and focused: one change per commit, with a regression test for every bug fix. 🛡️

## ✅ The verification loop

You need Rust 1.90.0 (pinned in `rust-toolchain.toml`), Node 22 with pnpm, and Docker. Run the checks that match what you changed before you push:

| Area | Commands |
|---|---|
| Rust format | `cargo fmt --check` |
| Rust lint | `cargo clippy --all-targets -- -D warnings` |
| Full Rust suite | `pnpm test:rust` — Docker only, see below 🐳 |
| UI | `pnpm --dir app/ui lint` and `pnpm --dir app/ui build` |

**🐳 The full Rust suite runs in Docker, never bare `cargo test` natively.** `pnpm test:rust` runs the workspace tests in a Linux container (`tests/docker-compose.test.yml`): the desktop crate's debug build peaks at several gigabytes natively, while the container caps `CARGO_BUILD_JOBS` at 2 and memory at 6 GB, so an over-sized run fails fast inside the box instead of on your machine. `target/` lives in a named volume, so only the first run compiles everything. `pnpm test:rust:report` additionally writes a JUnit report.

One gotcha: the app crate embeds `app/ui/dist` at compile time (`tauri::generate_context!`), so after touching the frontend, run `pnpm --dir app/ui build` before any Rust build or test.

## 📝 Commit style

- **One-line commit messages** — no body, no `Co-Authored-By` or other trailer lines.
- Example: `fix(print): honor the close delay on the spooler path`

## 🕸️ The graphify rule

This project has a knowledge graph in `graphify-out/`.

- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- `graphify-out/graph.json` is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild.

## 📚 Docs

The guides live in [`docs/`](docs/), in the same friendly, plain-English, tasteful-emoji tone as this file. When your change alters what people see or do, update the matching guide in the same change. ✏️

## 🚢 Releasing

Releases are date-versioned (`YYYY.MMDD.N`, for example `2026.1124.0`, then `2026.1124.1` for a second release the same day) and ship from `main`:

```bash
pnpm release                              # next date version; commits and tags
node scripts/release-local.mjs <version> --push   # build installers locally, attach to a draft release
```

Pushing the `v*` tag triggers the CI tag jobs: version check, MSI (Windows) and deb + AppImage (Linux) builds, a draft GitHub release, and the registry image on GHCR. Full guide: [`docs/RELEASE.md`](docs/RELEASE.md).

---

Thank you again for helping make PrintNinja better. 💙
