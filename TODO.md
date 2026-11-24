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

- [ ] D3 — PC sidebar: group the items, count badges (jobs, community
      saved), Settings pinned to the bottom
- [ ] D4 — PC top bar: brand + version on the left, a status dot + the
      account menu on the right
- [ ] D1 — icon system: `app/ui/src/lib/icons.ts` registry + `IconButton`
      (aria-label + Tooltip, `h-control w-control`), icons on primary
      buttons per plan §4.3; after this, screens never import
      lucide-react directly
- [ ] D2 — template card (PC §5.1 + phone): Print primary, Edit icon,
      ⋯ ActionMenu M2 (Publish/Unpublish, Duplicate, Delete danger;
      right-click on PC); M3 New-template split/FAB
- [ ] D5 — editor: split `editor-screen.tsx`, element rows with icons +
      ⋯ M8 (reorder up/down, delete), add-element icon toolbar, header
      inline name + unsaved dot + ⋯ M7 (template size, save)
- [ ] D6 — print screen (PC): sticky summary, distinct Preview (`Eye`)
      and Print (`Printer`) buttons, M9 menu (edit template, save as
      default printer, clear data)
- [ ] P6 — print screen (phone): sticky bottom action bar (above the
      bottom nav while visible), result banner
- [ ] P7 — editor (phone): canvas stays visible, property panel in a
      sheet, add-element toolbar as icons
- [ ] P8 — settings (phone): grouped list instead of the 4-tab strip,
      segmented theme/language controls
- [ ] D7 — top bar search field (Q3: search only, no command palette),
      job-row ⋯ M4 (Reprint, Retry, Open template, Copy reason)

## Final polish commit (plan phase 7)

- [ ] motion 120–200 ms on the standard interactions, loading skeletons,
      toasts where errors are surfaced inline, keyboard paths
- [ ] 360 px wide + Japanese overflow checks
- [ ] refresh `docs/UI_GUIDE.md`
- [ ] full `pnpm shots` matrix review; `pnpm shots:assets` for the README

## Docs (user-added)

- [ ] Check `docs/ROADMAP.md` and `docs/LIMITATIONS.md` against what now
      exists and update both
- [ ] Rewrite `docs/ROADMAP.md`: remove the implemented points, group
      the rest by priority (the header's rule: a point is deleted once
      implemented, undecided ones stay in "Needs confirmation")

## Final step

- [ ] Update README.md screenshots (fresh `pnpm shots`, then
      `pnpm shots:assets`) **before the final push**
- [ ] Push the last commits to `ui-improvement-plan`
- [ ] Delete the `docs/planned/` directory (with
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
