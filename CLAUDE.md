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

## The plan

`docs/planned/REFACTORING-PLAN.md` is the governing plan: two template
tracks (`scene` / `html`, html = `page` media only), profiles as data,
honest job result states, phase 0–11. Check the plan's open items before
hardware or platform work.
