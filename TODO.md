# TODO — finishing docs/planned/UI_IMPROVEMENT_PLAN.md

Working on branch `ui-improvement-plan` (cut from `develop`, pushed to
origin — keep pushing it as findings land). Policy:
**one local commit per finding** (P1–P8, D1–D7),
each ending with the house loop (biome lint + vite build, CHANGELOG bullet,
`graphify update .`, one-line message, no body, no Co-Authored-By) and a
push to the branch. At the very end: delete `docs/planned/` (including
`UI_IMPROVEMENT_PLAN.md`) and this `TODO.md`, and commit that deletion.

The plan doc is `docs/planned/UI_IMPROVEMENT_PLAN.md`; its §3.5 (ActionMenu
primitive), §4 (icon system, menus M1–M9), §5.1 (PC card layout) are the
spec for the items below.

## Done

- [x] D7 — PC top-bar search field (search only, no palette) and
      job-row ⋯ M4 (reprint, retry, open template, copy reason)
      (commit 8df3028)
- [x] P8 — phone settings: grouped list instead of the tab strip,
      segmented theme/language controls (commit e1a9772)
- [x] P7 — phone editor: canvas kept in view, property panel in a
      bottom sheet, add-element icon toolbar (commit 4c31b4f)
- [x] P6 — phone print screen: sticky bottom action bar (above the
      bottom nav while visible) and a result status banner (commit aba0e82)
- [x] D6 — PC print screen: sticky summary, distinct Preview (Eye) and
      Print (Printer) buttons, ⋯ M9 (edit template, save default printer,
      clear data) (commit 8026908)
- [x] D5 — editor split into components, element rows with icons +
      ⋯ M8 (reorder/delete), add-element icon toolbar, header inline
      name + unsaved dot + ⋯ M7 (size, save) (commit 42a9af4)
- [x] D2 — template card: Print primary, icon Edit, ⋯ menu (M2:
      publish/unpublish, duplicate, delete; right-click on PC) and
      new-template split/FAB (M3) (commit 88685b7)
- [x] D1 — icon system: `lib/icons.ts` registry + labelled `IconButton`
      with tooltips; no screen imports lucide-react directly and primary
      buttons carry icons (commit 5a2605c)
- [x] D4 — PC top bar: brand + version on the left (already in
      `layout.tsx`), status dot + account menu on the right (P4) — no
      further code needed; checked in the screenshot matrix
- [x] D3 — PC sidebar: grouped items, job and community-saved count
      badges, Settings pinned above Collapse (commit 32d4531)
- [x] P4 — account menu M1 in the top bar: one menu replacing
      RegistryChip + Sync + Sign out/Sign in + UpdateBadge (commit 6b3c0c8)
- [x] P1 — phone template card actions wrap (commit c449aa2)
- [x] P2 — stacked phone tab strips size to their triggers (commit 173ef13)
- [x] P5 — real back arrow in page headers, icon undo/redo in the scene
      editor (commit 6dea831)
- [x] P3 — phone bottom tab bar, five top-level destinations, app split
      into per-destination screens (commit 8a4c481). Screens now:
      `templates-screen.tsx`, `jobs-screen.tsx`, `printers-screen.tsx`,
      `community-screen.tsx`, `settings-screen.tsx`; `View` type in
      App.tsx is the 5 destinations + contextual print/edit/document-edit
      with a `from` key; `BottomNav` in-flow at the shell bottom, hidden
      on contextual screens and while a text field has focus.
      `scripts/screenshots.mjs` updated in the same commit (views:
      `settings-printers` → `printers`, new `jobs`).

## Remaining findings, in order

## Final polish and docs — done (commit 6556719)

- [x] motion 120–200 ms on the standard interactions, loading skeletons,
      toasts where errors are surfaced inline, keyboard paths
- [x] 360 px wide + Japanese overflow checks
- [x] refresh `docs/UI_GUIDE.md`
- [x] full `pnpm shots` matrix review; `pnpm shots:assets` for the README

## Docs — done (commit 6556719)

- [x] Check `docs/ROADMAP.md` and `docs/LIMITATIONS.md` against what now
      exists and update both
- [x] Rewrite `docs/ROADMAP.md`: remove the implemented points, group
      the rest by priority (the header's rule: a point is deleted once
      implemented, undecided ones stay in "Needs confirmation")

## Final step (push held back on user instruction)

- [x] Update README.md screenshots (fresh `pnpm shots`, then
      `pnpm shots:assets`) **before the final push**
- [x] Push the last commits to `ui-improvement-plan`
- [x] Delete the `docs/planned/` directory (with
      `UI_IMPROVEMENT_PLAN.md`) and this `TODO.md`, commit the deletion
      and push

## Notes

- Tooling on this machine (2026-11-24): `cargo` is not installed, so
  `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`
  cannot run locally — run them in CI or install Rust. The Rust suite
  itself runs in Docker (`pnpm test:rust`); no native full-suite run.
- Playwright on a fresh box needs both `pnpm exec playwright install
  chromium` and `pnpm exec playwright install-deps chromium` (the first
  `pnpm shots` run failed on a missing `libatk-1.0.so.0`); after that the
  full matrix passes. The `graphify` CLI is now installed via pip
  (`python3 -m pip install graphifyy`), so `graphify update .` works.
- Screenshots: `pnpm shots` from the repo root (app must not be on port
  1420); the fake-bridge seed in `scripts/screenshots.mjs` keeps the
  working-shop state. The account-menu view was added in P4; `pnpm
  shots --views account-menu` renders just that view.
- Keep pre-existing unrelated working-tree changes out of commits
  (e.g. the `app/gen/schemas/*.json` Tauri build artifacts).
- i18n: every new key goes into both `en.ts` and `ja.ts`
  (`ja` is typed as `EnStrings`).
