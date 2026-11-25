# PrintNinja UX review — making the app feel natural

> Branch studied: `develop` (v2026.1124.0). Based on reading `app/ui/src` end to end and on the
> repo's own screenshot matrix (`pnpm shots`, desktop + phone viewport).
> Scope: the UI/flows only, plus the account/sync server work the new requirements need. No printing-pipeline changes are proposed here.
> Status: **final** — every open question has an answer (section 10).

## 0. Confirmed product decisions (summary)

1. **Sign-in is mandatory.** Until a user logs in, nothing else works. Login/register = server URL + name + password (section 7).
2. **Server URL** is prefilled from the frontend build env (`VITE_REGISTRY_URL`) but editable (9.6).
3. **Offline-first:** templates sync at an interval and are kept as an identical local copy; printing never needs the server; a manual **Sync** button sits in the nav (section 9).
4. **A saved login opens the app with the server unreachable** — local data only. `https://` is not required.
5. **Templates are per account; jobs, saved printers and settings are per device.**
6. **Local print API and `printninja://` links do not work while logged out.**
7. **Corporate look** (light + a derived dark theme) with the palette Primary `#24345B`, Secondary `#52678D`, Accent `#B49A76`, Background `#F3F0EA`, Surface `#FFFFFF`, Text `#34383D`; name/logo fixed in the build (section 8).
8. **Sync:** every 5 minutes (configurable); conflicts keep both versions; the server gets a private per-account template API (9.8).
9. **Sign out removes the account's local templates** from the device (after a final sync and a warning if anything is unsynced) (9.7).
10. **Starter templates are not account data.** "New template" offers *Blank* or a *starter*; the choice creates a normal template (R9).
11. **"Name" in the login is the unique registry handle.** The phone's Sync button is a top-bar icon.
12. **The app keeps running in the background by default** (closing the window hides it to the tray); users can turn this off in Settings (9.9).

## 1. The core problem in one paragraph

The app is organised around **how it is built** (templates → profiles → transports → bytes), not
around **what the person is trying to do** ("print this label on that printer"). Every print asks
the user to think about *printer profile model*, *transport*, *host/port*, *raw JSON data* and
*bytes*. The screens that exist are individually tidy, but the journey between them is long,
repetitive and forgetful, so the app feels like a developer tool rather than a daily print tool.

The target journey should be: **open app → pick what to print → fill in the values → Print.**
Everything else (which printer, how it is connected) should be remembered and out of the way.

## 2. What the app does today (short study notes)

| Area | Where | Observation |
|---|---|---|
| Shell/nav | `App.tsx`, `components/layout.tsx`, `bottom-nav.tsx`, `lib/nav.ts` | 5 destinations (Templates, Jobs, Printers, Community, Settings). Navigation is a single `useState` `view` object — no router. |
| Templates | `screens/templates-screen.tsx` | A plain vertical list of cards: icon, name, badge, description, Edit / Print / ⋯. No preview, no sort, no "last used". |
| Print | `screens/print-screen.tsx` (769 lines) | Three form cards (Printer, "Where the bytes go", Data) + a right column with Job summary and Preview/Print. |
| Jobs | `screens/jobs-screen.tsx` | Last 10 jobs only; actions hidden in ⋯. |
| Printers | `screens/printers-screen.tsx`, `components/printers-card.tsx` | Saved printers + scan/add form, followed by one card per *profile* with chunk/pause/delay numbers. |
| Editors | `screens/editor-screen.tsx` (1201 lines), `document-editor-screen.tsx` | Scene editor with canvas; document editor is a raw HTML/CSS textarea. |
| Settings | `screens/settings-screen.tsx` | 5 tabs mixing appearance, LAN pairing, registry URL, diagnostics. |

## 3. Findings

Severity: **P0** = blocks natural use, **P1** = frequent friction, **P2** = polish.

### P0 — The print screen asks the wrong questions

1. **Two printer pickers, and neither is "my printer".** The Printer card shows an optional
   "Saved printer" dropdown *and* a second dropdown of printer **profile models** (e.g. `ZT411`).
   The helper text says "the profile is the printer". A user who saved "Packing desk Zebra"
   must still understand that the second dropdown is a technical model profile.
   (`print-screen.tsx` ~L406–446)
2. **Connection details are re-asked on every print.** The "Where the bytes go" card shows
   transport type, host and port. The default is a placeholder: **TCP `127.0.0.1:9100`**
   (`print-screen.tsx` L121–122) — an address that is almost never right for a real printer, and
   it is what a new user sees first. With a saved printer chosen, this whole card is redundant.
3. **Nothing is remembered.** "Save as default printer" writes the setting `defaultPrinter`
   (`print-screen.tsx` L346) but **nothing ever reads it** (grep finds only that one reference).
   So the menu item looks like it works and does nothing. The last-used printer, transport,
   copies and data are also reset on every visit.
4. **Data entry is a JSON text box.** Users must type or paste
   `[{"name":"BOLT M8"},...]` (or CSV). The template already declares its fields
   (`{{name}}`), yet the UI never generates inputs for them. This is the single biggest "not
   natural" moment: a shop user wants a **Name** field and a **Quantity**, not JSON.
5. **The primary action is far from the form.** On desktop, Preview/Print live in the right
   column, in a card titled "Preview", below a "Job summary" that repeats what the left column
   already shows. On the phone the Print button is a fixed bar but the data textarea sits several
   screens down, below Data URL + Method controls that most people never use.
6. **Preview is manual.** The user must press Preview; nothing shows until they do. For label
   work the preview is the main feedback loop.

### P1 — Navigation and structure

7. **No real routing.** All screens are one `view` state (`App.tsx` L159). Consequences: refresh
   or app restart always returns to Templates; the Android back gesture / browser back does not
   behave like "back" (each screen has its own arrow); deep state like "printing template X" cannot
   be linked, bookmarked or restored.
8. **Printer setup lives in the wrong place and is split in two.** The Printers page puts
   saved printers first, then a long list of **every bundled profile** with chunk size / pause /
   close-delay fields. That second section is expert tuning for ~11 profiles, shown by default.
   Adding a printer is a form with name, *profile*, *transport*, *host* — the profile choice is a
   guess for most users (the roadmap already lists "Capability probe on add / Detect").
9. **Saved printer rows hide what they are.** A saved row shows `name · model` and Remove.
   No transport/address, no status, no "set as default", no "edit". (Also called out in
   `docs/ROADMAP.md`.)
10. **First-run is empty of guidance.** A new user lands on two starter templates, with no printer
    configured and no hint to add one. Print then fails against `127.0.0.1:9100`. The roadmap lists
    onboarding as post-release; it is arguably the main thing that makes the app feel unnatural.
11. **Templates screen is a plain list.** No thumbnail of the label, no "last printed / used on
    printer X", no sort, no recents/favourites. Starter and user templates are mixed. On a list of
    20+ templates this does not scale, and a thumbnail is the natural way to recognise a label.
12. **Top-bar search is global but only searches templates.** Typing anywhere jumps the app to the
    Templates view (`App.tsx` L488–492). It is hidden on phones, where the list is likely longest.
13. **Account/registry noise.** The community registry (sign-in with *server address*, publish,
    sync, "N waiting") is a first-level destination plus a top-bar control, but printing never needs
    it. Registry errors appear as a global red banner above whatever screen you are on
    (`App.tsx` L531–537) and persist.
14. **Settings mixes unrelated things.** Appearance, LAN print pairing, "block private IP
    ranges", registry URL and Diagnostics (log, browser download, "Fix PC printing") are peers in
    five tabs. Day-to-day settings and "something is broken" tools should be separated.

### P1 — Jobs

15. **Jobs is a read-only log with the useful actions hidden.** Only the last 10 jobs are kept.
    Reprint/Retry/Open template/Copy reason are all inside ⋯. The most common action ("print this
    again") should be one visible button on the row; failures should show the reason inline, not
    after opening a menu.
16. **"Open template" from a job creates a pseudo-template** whose `id` is the *job id*
    (`App.tsx` L571–593). Saving it adds a new template with a job-shaped id and empty description,
    rather than editing the original.
17. **Reprint vs print history is inconsistent** (reprint overwrites the row; a new print adds a
    row — already noted in the roadmap's "Needs confirmation").

### P1 — Editors

18. **Scene editor header is overloaded.** On the phone the header wraps to three rows (name,
    badge/undo/redo/Save, Preview/⋯), pushing the actual canvas below the fold
    (see phone `edit` screenshot). Save is duplicated in the ⋯ menu.
19. **Preview needs a printer.** The editor's Preview prepares a job on whichever printer is
    first in the list, which can silently change how it looks (dpi). It should default to the
    printer the user normally uses.
20. **No unsaved-changes guard.** The editor shows a dot when dirty, but Back/nav discards edits
    with no confirmation (no `confirm`/`beforeunload` handling anywhere in `app/ui/src`).
21. **Element properties are a form of millimetres.** Editing = typing X/Y/W/H numbers. There is
    no snapping, alignment, or "fit to label" helpers, and nothing to add a field from a list of
    known data fields.
22. **Document editor is code-only.** HTML/CSS in a monospace textarea, with a separate live
    preview. Fine for developers, not for the "invoice/receipt" users the README targets. At
    minimum: sample data and preview side by side, and a way to insert `{{field}}` chips.
23. **New templates are hardcoded in English** ("New label", "A 40 × 50 mm label.",
    "New document") and bypass i18n (`App.tsx` L439–445, `templates.ts` L45–70) — already in the
    roadmap; visible bug in the Japanese UI.

### P2 — Polish and consistency

24. Jargon in user-facing text: "Where the bytes go", "transport", "profile", "Raw port (TCP)",
    "Chunk size (bytes)", "Close delay (ms)", "scene"/"document" badges, "track". Use job words
    ("Connection", "Printer model", "Label template / Page template").
25. Result words are good ("Confirmed", "Sent, not confirmed") but the result card appears at the
    bottom of the right column; on a phone it can land off-screen after pressing Print. Scroll to
    it or show a sheet/toast.
26. Copies is the last field of the Data card and is a free text input; a stepper (− 1 +) in the
    action bar is the natural control.
27. Delete is disabled for published templates with no explanation (`delete_blocked` string exists
    but is only a tooltip-level hint).
28. Success/failure feedback is inconsistent: toasts in some places, inline text in others, a
    global banner for registry errors.
29. Bottom tab bar has 5 items including Community and Settings; on phones Print/Edit hide it,
    but Templates → Print → back is the only real loop, so it is rarely useful there.

## 4. Recommendations

### R1 — Rebuild the print screen around "what & where" (fixes #1–6, 25–26)

Proposed layout (single column on phone, same order on desktop with the label preview on the right):

```
< Parts label                                   [⋯]
Printer:  [ Packing desk Zebra  ▾ ]   ● ready        <- saved printer only
Fields:   Name  [ BOLT M8        ]
          Qty   [ 12             ]
          [ + Add another label ]  or  [ Import CSV ]
Copies:   [ − 1 + ]
[ live label preview ]
                                  [  Print  ]        <- sticky bottom on phone
```

Concretely:

- **Pick a saved printer, not a profile.** One dropdown. The profile and transport come from the
  saved printer record (the code already does this in `pickSaved`). If there are no saved
  printers, replace the form with an inline "Add your printer" step (see R3) instead of defaulting
  to `127.0.0.1:9100`.
- **Remember the last-used printer, copies and data per template** (add `lastPrinter`, store per
  template id). Make "Save as default printer" real, or delete the menu item. Preselect
  default → last used → only one saved.
- **Generate a form from the template's fields.** `Template.fields` / `allBindings()` already list
  the bindings. Render one input per field; each "row" is one record. Offer a table-style entry for
  multiple labels, plus **Import CSV / Paste from Excel**. Keep the raw JSON/CSV box under an
  "Advanced: edit as text" disclosure.
- **Move Data URL + method behind "Advanced"** with the raw text mode; it is a developer/integration
  feature.
- **Move transport editing into the printer record.** On the print screen show it as read-only text
  (`Zebra ZT411 · 192.168.1.40:9100`) with an "Edit printer" link. A one-off "use another
  connection" can stay under Advanced.
- **Auto-preview**: debounce 400 ms after field/printer changes and show the preview next to the
  form (desktop) or under the fields (phone). Remove the separate "Job summary" card; the page
  itself is the summary.
- **Sticky action bar** on both desktop and phone: copies stepper + Print. Preview becomes
  automatic, not a button.
- **After printing**, show the result as a banner under the action bar and scroll to it; offer
  "Print again" and "Edit values".

### R2 — Real routing and state restore (fixes #7, 12, 29)

- Introduce a lightweight router (e.g. `react-router` hash routing, which works in Tauri and the
  Android WebView): `/templates`, `/print/:templateId`, `/templates/:id/edit`, `/jobs`, `/printers`,
  `/settings/:tab`, `/community`.
- Gives working system **Back** on Android, restores the screen after a restart/refresh, and lets
  deep links (`printninja://print?...`) map to a normal URL.
- Keep `App.tsx` as a data provider only; split the 780-line file into a templates store, a
  registry store and the dialogs (publish/sign-in) so screens stop receiving 15 props.
- Make search a Templates-page control that also appears on phones, not a global top-bar control.

### R3 — A guided "Add your printer" flow and first-run (fixes #8–10, 24)

1. First launch (no saved printers): a 3-step card on the Templates page —
   **① Add a printer → ② Test print → ③ Print a sample label.**
2. Add printer wizard: *Find printers* (scan system + network in one button; results as one list)
   → pick one → **auto-detect the model/profile** (the roadmap's "Capability probe on add") →
   name it → **Test print** → done. "Add manually" stays as a secondary link.
3. Printer cards show: name, connection summary, model, last test result, **Set default**,
   **Test print**, **Edit**, **Remove**.
4. Collapse per-profile "chunk size / pause / close delay" into a "Printer tuning (advanced)"
   section inside each saved printer, instead of a long list of all bundled profiles.

### R4 — Templates page that scales (fixes #11, 27)

- Show a **thumbnail** of each label (the `SceneCanvas` / planner preview already renders one)
  and the last-used printer + last printed time.
- Sections: **Recent** (last 5 printed), **All templates**; sort (name / last used / created);
  filter chip for label vs page templates.
- Make the whole card tappable to **Print** (primary action); keep Edit and ⋯ as secondary.
- The list shows **only the account's own templates**; starters are offered in the New template picker (R9), not in the list.
- Explain disabled Delete inline ("Unpublish first").

### R5 — Jobs that work as history *and* as shortcuts (fixes #15–17)

- Row: template name, printer, time, result badge, **reason inline when failed**,
  and two visible buttons: **Print again** and (when failed) **Retry**. Keep ⋯ for the rest.
- Raise the 10-job limit (roadmap lists retention as later; 50–100 is a cheap first step) and add a
  simple "Clear history".
- "Open template" should open the real template by id (store `templateId` on the job; fall back to
  a clearly-labelled "Copy of …" if it was deleted).
- Decide reprint semantics (new row vs update) and apply one rule.

### R6 — Editors (fixes #18–23)

- Header: name + Save only; undo/redo, preview and ⋯ move to a toolbar row below it on phones.
  Remove the duplicate Save in ⋯.
- Add the **Unsaved changes** guard on Back / navigation ("Save, discard, keep editing").
- Default the preview printer to the user's default printer.
- "Add field" button that lists known data fields and drops a bound text element; "Fit to label",
  align and distribute helpers; arrow-key nudging already exists, add snap-to-grid toggle.
- Document editor: split view (code | live preview) on desktop; a `{{field}}` insert menu; a
  few starter layouts (receipt, invoice, delivery slip — the roadmap notes the old app shipped six).
- Fix hardcoded English defaults by moving them to locale keys.

### R7 — Settings and account (fixes #13–14)

- Settings groups: **General** (language, theme, startup, keep running in the background) · **Printing** (data guards, browser for
  documents) · **Connect devices** (LAN/pairing) · **Community** (registry + account) ·
  **Troubleshooting** (log, diagnostics bundle, Fix PC printing).
- Show registry errors in the Community screen / account menu, not as a global banner; auto-dismiss
  non-actionable ones. Consider moving **Community** out of the main nav into a secondary section
  (it is not part of the daily print loop).

### R8 — Language and feedback (fixes #24, 28)

| Now | Suggest |
|---|---|
| Where the bytes go / Transport | Connection |
| Profile / "the profile is the printer" | Printer model |
| Raw port (TCP) | Network printer (IP address) |
| Spooler (Windows) | Installed printer (Windows) |
| scene / document | Label / Page |
| Data URL, Method | Advanced: load data from a web address |

Use one feedback pattern: toast for success of small actions, inline banner for blocking
errors with a "what to do next" line.

### R9 — New template: start from a starter or blank (confirmed)

- **Starters are read-only samples shipped with the build, not account data.** They are never
  listed in Templates, never synced, and cannot be deleted or hidden.
- **New template** opens a picker: **Blank label**, **Blank document**, and starter cards with a
  thumbnail (today *Parts label* and *A4 note*; the roadmap lists receipt, delivery slip, invoice,
  shipping label and kitchen ticket as candidates). Choosing one **creates a normal template in the
  account** (a copy with a new id), opens it in the editor, and from then on it is saved and synced
  like any other template.
- **Empty state** for a new account: "No templates yet" with the same picker, so the first minute is
  *pick a starter -> edit -> print*.
- **Code impact:** keep `starters` in `templates.ts` as the catalogue; remove the seeding of
  starters into the list (`mergeTemplates(base, rows)` and the `deletedTemplates` tombstone logic,
  `DELETED_STARTERS_KEY` in `App.tsx`); replace the two-button "New template" dialog with the picker;
  name/description of new templates come from the locale files (this also fixes the hardcoded
  English "New label" / "New document").

## 5. Suggested order of work

| Phase | Work | Why first |
|---|---|---|
| 0 (new requirement) | Mandatory sign-in gate (section 7): auth screen, session restore, `https` rule, offline decision | Everything else sits behind it, so its decisions (offline, per-account data) shape later phases |
| 0b (new requirement) | Corporate look (section 8): tokens, flat primitives, light default, shell header, then tables | Token change restyles the whole app in one step and should land before screen rework |
| 0c (new requirement) | Offline-first template sync: **server API first** (9.8), then local per-account store, background scheduler, manual Sync button (section 9) | Printing must work from local data before the gate and login rely on a saved session |
| 0d (new requirement) | New template from starter or blank (R9); stop seeding starters into the list | Must land before sync so starters never enter the synced set |
| 0e (new requirement) | "Keep running in the background" setting, tray menu with Sync now/status, quit warning (9.9) | Small and independent; the sync scheduler depends on the app staying alive |
| 1 (small, high value) | Make "default/last used printer" real; hide transport when a saved printer is chosen; no 127.0.0.1 default; Copies stepper; sticky Print on desktop; move Data URL to Advanced; fix hardcoded English template names | Pure UI, no backend change, removes most daily friction |
| 2 | Field-based data entry (generated form + CSV import) and auto-preview | The biggest "natural" gain |
| 3 | Add-printer wizard + first-run checklist + printer cards with default/edit/test | Fixes the empty-start problem |
| 4 | Router + store split; unsaved-changes guard; Jobs row actions and real "open template" | Structural; unlocks Android back and restore |
| 5 | Templates thumbnails/recents; editor header & document editor improvements; settings regrouping | Polish |

## 6. How to verify improvements

- `pnpm shots` already renders every screen for desktop and a Pixel-7-sized phone in both
  languages and themes — use it as the before/after check for each phase (the print, edit and
  printers screens change the most).
- Add the UI-level e2e the roadmap leaves "optional" for the single key journey:
  *open → choose template → fill a field → Print → see Confirmed*, against the repo's virtual
  printer (`tests/e2e/support/virtual-printer`). This journey is exactly what these changes target.
- Measure success as taps/keystrokes from app start to a printed label for a returning user
  (target: template → Print in ≤ 3 interactions when the printer and data are remembered).

## 7. Product requirement: sign-in is mandatory

**Requirement (from the product owner):** when the app opens, the user must register or log in.
Both need exactly three things — **server URL, name, password**. The app is usable only after a
successful login.

### 7.1 What exists today

- Sign-in already exists as an optional dialog (`App.tsx`, `registryLogin(handle, password, create, url)`),
  opened from the account menu. It already collects server address + handle + password and has a
  "Create the account" switch, so the form and the backend call are reusable.
- Today the app starts straight on Templates; `registryStatus()` is only a probe. The default server is
  `http://127.0.0.1:8787` (`app/src/registry.rs`), i.e. a registry on the same PC.
- "Name" in this requirement maps to the registry's **handle** (no email; no password reset).

### 7.2 Proposed behaviour

1. **Auth gate before the shell.** On start, `App` asks for the session state first. No session →
   render a full-screen **Sign in / Create account** screen with no sidebar, bottom tab bar, search or
   account menu. Session valid → render the normal app. Show a short splash while this is checked,
   so there is no flash of the app.
2. **One screen, two modes.** A segmented control **Sign in | Create account** (not a hidden
   switch). Fields: **Server URL**, **Name**, **Password** (with show/hide). Create mode may add
   "Repeat password" as a UI-side check only (still three values sent). One primary button, inline
   errors under the field they belong to ("Cannot reach the server", "Wrong name or password",
   "That name is taken").
3. **Remember the session.** Keep the token and last server URL/name, so the user logs in once, not
   on every launch (and not every time the autostarted tray app wakes). Prefill server URL and name
   on the sign-in screen after a sign-out. Never store the password itself.
4. **Server URL field done right.** Trim; add `https://` if the scheme is missing for non-local
   hosts; validate before sending; "Test connection" feedback (green tick on success); keep the
   baked-in default (`VITE_REGISTRY_URL`) prefilled.
5. **Sign out** lives in the account menu and returns to the gate. Decide what happens to local
   data (decided in 9.7: sign-out removes the account's local templates).
6. **After login**, go straight to the first-run checklist of R3 (add printer → test print →
   first label) when the user has no saved printer.

### 7.3 Things this requirement changes or puts at risk

| Topic | Issue | Suggested handling |
|---|---|---|
| **Offline use** | README/features promise "offline-first — printing never waits on a server". A hard gate means a warehouse PC with the registry down cannot print at all. | Allow a **cached session to open the app offline** (login only needed when there is no valid session). Show the offline dot but do not block printing. Only a *first* login requires the server. |
| **No hosted registry** | `docs/LIMITATIONS.md`: the registry is self-hosted; there is no managed service. Users must know a server URL before they can even open the app. | Ship a prefilled default per build (`VITE_REGISTRY_URL`), allow scanning a QR / pasting an invite link containing the URL, and explain on the screen what the URL is ("Ask your admin for the server address"). |
| **Passwords in clear text** | `LIMITATIONS.md`: no TLS on the registry; `http://` is used. Mandatory login makes every user send a password over HTTP. | Require `https://` for non-local servers (warn or block `http://` unless the host is loopback/LAN and the user confirms). Treat TLS as a release gate for this requirement. |
| **No password reset** | Accounts are handle + password only. A forgotten password means a new account and re-publishing. When login is mandatory this becomes "locked out of the whole app". | Either add an admin reset on the server or a recovery code at sign-up, before making login mandatory. |
| **Local print API, `printninja://` links, LAN pairing** | They run without a UI session today (`127.0.0.1:17717`). | Decide explicitly: keep them independent of the login (recommended, they have their own pairing/tokens), but make a deep link that arrives while logged out wait and resume after login. |
| **Autostart / tray** | The app can start at sign-in and live in the tray. | Restore the saved session silently; only show the gate when there is none or it expired. |
| **Multiple people on one PC** | Templates and jobs are stored locally, not per account. | Either scope local data per account, or state clearly that local data is per-device and shared by whoever signs in. |
| **Community/Sync** | If everyone is signed in, "Sign in" in the account menu, the "not signed in" state and the signed-out error paths (`canSave`, `openPublish` → sign-in dialog) become dead code. | Remove the optional sign-in dialog and the signed-out branches; move the account menu to show name, server, sync, sign out. |

### 7.4 Implementation sketch (frontend)

- New `screens/auth-screen.tsx` (full-screen, mobile-first single column, 3 fields + mode switch).
- New `auth` state in `App` (`loading | signedOut | signedIn`), computed from `registryStatus()` at
  start; render `<AuthScreen/>` instead of `<Layout/>` unless `signedIn`. Reuse `registryLogin`,
  `registryStatus`, `registryUrl`.
- Reuse the strings in `locales/en.ts` / `ja.ts` (`registry.*`) and add keys for the new inline
  errors; keep both languages in step.
- Move the sign-in `Dialog` out of `App.tsx` (it is ~70 lines of that file) into the new screen.
- Backend: confirm `registry_status` reports a persisted session across restarts and add an explicit
  `auth_state` (valid / expired / offline-cached) so the UI can tell "offline with a session"
  from "no session".
- Add the key journey to the e2e/screenshot matrix: **gate → register → first-run checklist**, and
  **gate → login → Templates**, in both languages and both viewports.

## 8. Product requirement: a corporate visual style

**Requirement:** the UI should look and feel corporate — sober, dense, trustworthy, business-tool —
not like a friendly consumer app.

### 8.1 Where the current look stands (from `index.css`, `tailwind.config.ts`, screenshots)

What is already a good base and should be kept:
- A real design-token system (HSL variables for surfaces, status colours, shadows, radius,
  density, motion), light and dark sets, and WCAG-AA-checked pairs.
- IBM Plex Sans: a neutral, "enterprise" typeface that pairs well with the Japanese system fonts.
- A named type scale (12/13/14/18/24 px), status colour + icon + word badges, Radix primitives.

What reads as consumer / informal today:
| # | Observation | Where |
|---|---|---|
| a | **Soft "paper on a desk" look**: pale green-grey backgrounds, white floating cards with soft shadows, large rounded corners (`rounded-xl`; `1.25rem` on phone), tap "squish" animation (`active:scale-[0.97]`). Feels like a mobile app, not a business console. | `layout.tsx`, `jobs-screen.tsx`, `button.tsx` |
| b | **Everything is a card in a vertical stack**, even tabular data (jobs, printers, community, templates). Corporate users expect tables with columns, sorting and filtering. | all list screens |
| c | **Bright teal brand + a violet "highlight"** accent and tinted-green surfaces. The palette is distinctive, not neutral. | `index.css` tokens |
| d | **Informal copy**: "Pick a template, enter the data, print.", "Where the bytes go", "ninja" branding, README emoji tone. | `locales/en.ts`, README |
| e | **Inconsistent theme default**: CSS says "Light is the default", but `App.tsx` applies `s.theme ?? "dark"`, so a first run opens dark. Corporate environments expect light (or follow the OS). | `App.tsx` L196 |
| f | **Generic shell**: the top bar shows only the logo glyph + "PrintNinja"; no organisation name, user name/role, or environment/server indicator. | `layout.tsx`, `account-menu.tsx` |
| g | **Density option exists in CSS** (`data-density="compact"`) but is not exposed in Settings. | `index.css`, roadmap "Appearance extras" |
| h | Page titles and badges use lower-case tags (`scene`, `document`, `published`) and pills of many colours. | `templates-screen.tsx` |

### 8.2 Proposed corporate look

> The colour values below are superseded by the confirmed palette in 8.4; the structure (neutral base, one brand colour, flat panels) still applies.

**Palette**
- Neutral base: white / cool-grey (`#F7F8FA` work area, `#FFFFFF` surfaces, `#1F2937` text),
  borders instead of shadows (1 px `#E5E7EB`), no tinted-green backgrounds.
- **One** restrained brand colour (a deep blue or the existing teal, desaturated) used only for
  primary actions, links, selected nav item and focus rings. Remove the violet `highlight`.
- Status colours stay (success/warning/danger/info) but are used only for state, always with icon + word.
- Make the brand colour **themeable per organisation** (a single `--primary` token already drives the
  app), so a company can apply its own logo and colour (the roadmap lists "custom app name and logo").
- Default theme: **Light**, with a "Follow system" option; fix the `"dark"` default.

**Shape and depth**
- One radius scale: 6 px controls, 8 px panels, 0 px table rows. Drop the 1.25 rem phone cards and
  the press-scale animation; keep a subtle 120 ms colour transition only.
- Flat panels with hairline borders; shadows reserved for menus, dialogs and the sticky header.

**Layout**
- App shell: 48 px top bar with **organisation logo/name on the left** and, on the right,
  **server/environment chip, user name + role, sync status, help**. Left nav with text-first items,
  a narrower width, and section labels.
- Replace card lists with **data tables** (desktop) and compact rows (phone) for Templates, Jobs,
  Printers and Community: columns (Name, Type, Last used, Printer, Owner, Status), sortable headers,
  column filters, row hover, a visible primary action per row, bulk select where it makes sense.
- Page header: title + breadcrumb + a single primary button on the right; secondary actions in a
  toolbar row; descriptions only where they help.
- Forms: label above field, helper text below, consistent 2-column layout on desktop, sections with
  headings ("Printer", "Label data", "Output") and a sticky footer with **Cancel / Print**.
- Offer **Comfortable / Compact density** in Settings (tokens already exist) and default to compact
  on desktop.

**Typography and copy**
- Keep IBM Plex Sans (+ Plex Mono for IDs, addresses, bytes). Title-case page titles, sentence-case
  controls, no emoji, no slogans.
- Business wording instead of internal jargon (see R8): "Connection", "Printer model", "Label
  template", "Document template", "Print job", "Audit log".
- The Templates page title should be **"Templates"**, not the product name; put the product name in the
  top bar only.

**Corporate features that make it feel like business software**
- Show **who printed what** in Jobs (user, device, time, server) — natural with mandatory sign-in.
- A proper **sign-in page** with the organisation logo, the server it connects to, version and a
  legal/support footer; "Signed in as …" and sign-out in a user menu.
- Predictable keyboard support (tab order, Enter to submit, `Ctrl+P` to print, `Ctrl+S` to save),
  consistent empty/error/loading states, and confirmation dialogs for destructive actions.
- Help and "Contact your administrator" links; a status page for server/printers.

### 8.3 How to apply it with the existing code

1. **Tokens first** (`index.css`, `tailwind.config.ts`): new neutral palette, radius scale, remove
   `--highlight`, make `--primary` the organisation colour, default `data-theme` to light/system.
   Everything inherits, so this alone changes the whole look in one commit.
2. **Primitives** (`components/ui/*`): flatten `Card` (border, no shadow), `Button` (6 px radius, no
   scale animation), `Badge` (square-ish chip, upper-case-free), add a `DataTable` built on the
   existing `ui/table.tsx`.
3. **Shell** (`layout.tsx`, `account-menu.tsx`): organisation header, user/role/server chip, narrower
   sidebar.
4. **Screens**: convert Templates, Jobs, Printers and Community from card lists to tables, one at a
   time; reorganise the print screen as sectioned form + preview (R1).
5. **Copy pass** on `en.ts`/`ja.ts` together (both languages), then refresh screenshots with
   `pnpm shots` and `pnpm shots:assets`.

### 8.4 Confirmed colour palette

| Role | Hex | Use in the UI |
|---|---|---|
| **Primary** | `#24345B` | Top bar, primary buttons, links, focus ring, selected-state text |
| **Secondary** | `#52678D` | Secondary buttons, icons, info states, hover/selected tints |
| **Accent** | `#B49A76` | Decoration only: active-nav marker, selected-row edge, dividers, small highlights |
| **Background** | `#F3F0EA` | Work area behind panels |
| **Surface** | `#FFFFFF` | Panels, tables, dialogs, inputs |
| **Text** | `#34383D` | Body text |

Contrast check (WCAG 2.1, computed for this review):

| Pair | Ratio | Verdict |
|---|---|---|
| White on Primary | 12.2 : 1 | AAA |
| White on Secondary | 5.7 : 1 | AA |
| Text on Background | 10.4 : 1 | AAA |
| Text on Surface | 11.8 : 1 | AAA |
| Primary on Background | 10.8 : 1 | AAA |
| Secondary on Surface / Background | 5.7 / 5.0 : 1 | AA |
| Primary on Accent | 4.6 : 1 | AA (normal text) |
| **Accent on Surface / Background** | **2.7 / 2.4 : 1** | **Fails for text and for form-control borders** |
| White on Accent | 2.7 : 1 | Fails |

Rules that follow:
- **Never use Accent for text, icons that carry meaning, or input borders.** Use it for
  decoration only. When a gold *text* colour is needed, use a darker derived tone `#7A5F37`
  (6.0 : 1 on white, 5.3 : 1 on Background). Text placed on an Accent fill is Primary.
- Derived neutrals (not in the brief, proposed): muted text `#5B6168` (5.5 : 1 on Background),
  decorative border `#DDD8CE`, input border `#7C828A` (3.4 : 1, meets the 3 : 1 control rule),
  primary hover `#1B284A`, selected-row tint `#E6EAF2`.
- Status colours (success/warning/danger) stay, re-checked on the new Background; they remain
  state-only and are always shown with an icon and a word.
- Remove the violet `--highlight` token and the teal values in `index.css`.

Suggested token mapping in `index.css` (`:root`):

```css
--background: 40 25% 93%;      /* #F3F0EA */
--card:       0 0% 100%;       /* #FFFFFF surface */
--foreground: 213 8% 22%;      /* #34383D */
--primary:    222 43% 25%;     /* #24345B */
--primary-foreground: 0 0% 100%;
--secondary:  220 26% 45%;     /* #52678D */
--accent:     36 25% 55%;      /* #B49A76 (decoration only) */
--chrome:     222 43% 25%;     /* top bar uses the primary navy, white text */
```

Shell: **navy top bar** (white logo and text), **white sidebar** with a hairline border and an
Accent bar marking the active item, Background-coloured work area, white flat panels.

**Dark theme (confirmed: keep it, derived from the palette).** Same hues, inverted roles; the
Settings → Appearance choice becomes **Light (default) / Dark / Follow system**.

| Role | Dark hex | Notes |
|---|---|---|
| Background | `#141923` | Work area |
| Surface | `#1C2330` | Panels, tables, dialogs, inputs |
| Chrome | `#0F1420` | Top bar (white text, 18.4 : 1) |
| Text | `#E8E6E1` | 14.1 : 1 on Background, 12.6 : 1 on Surface |
| Muted text | `#A7ADB8` | 7.8 : 1 / 7.0 : 1 |
| Primary (buttons, links) | `#9DB2E3` | 7.4 : 1 on Surface; button label `#141923` on it 8.3 : 1 |
| Secondary | `#7F93BD` | 5.1 : 1 on Surface |
| Accent | `#C9B290` | Lightened; passes as text in dark (7.7 : 1) but is still used sparingly |
| Border / input border | `#2B3445` / `#7C869A` | Input border 4.3 : 1 on Surface (needs 3 : 1) |
| Status | success `#7FCB8C`, warning `#E5B75A`, danger `#F08A80` | 6.5–8.4 : 1 on Surface |

In dark mode elevation comes from borders and slightly lighter surfaces, not shadows. Delete the
old teal dark values in `index.css` and fix the first-run default (`s.theme ?? "dark"` in `App.tsx`
-> light).

### 8.5 Organisation name and logo are fixed in the build

Since branding is build-time, no server call or runtime theme is needed:
- Add build variables (e.g. `VITE_APP_NAME`, `VITE_APP_LOGO`) read in one `brand.ts`; the top bar,
  gate screen, window title and document `<title>` all read from it. Today the name comes from the
  i18n key `app.title` and the logo is a fixed icon in `layout.tsx` — both move to `brand.ts`.
- Desktop/Android packaging uses the same identity: `app/tauri.conf.json` (`productName`, window
  title, bundle identifier) and `app/icons/`. Keep these in one rebranding checklist so a new
  organisation build is: set env, replace icons, build.
- Keep a bilingual product name option if the organisation needs one (EN/JA).

### 8.6 Cards vs tables on the phone (decision: tables on desktop, rows on phone)

- **Desktop / tablet (≥ 768 px):** real data tables with sortable columns (Name, Type, Last
  printed, Printer, Status), sticky header, row hover, primary action on the row.
- **Phone:** *not* a squeezed table (4–5 columns do not fit 360–412 px) and *not* the current
  large rounded cards. Use **flat full-width list rows** separated by hairlines: title + one secondary
  line, a status chip on the right, the whole row tappable (Print / Open), `⋯` for the rest, sort and
  filter in a compact bar above. Same data and order as the table, so the two feel like one product.

## 9. Offline-first sync of templates

**Requirement:** templates sync with the server at an interval and a **local copy identical to
the server's** is kept, so printing never needs the server. Users can also sync manually from a
nav button.

### 9.1 Principles

- The **local database is the working copy.** Print, preview, edit and reprint read and write
  only local data. A job never waits for, or fails because of, the network.
- The server is used for **sync and sign-in only**. After a successful sync, the account's local
  template set equals the server's (same ids, same revision, same content).
- Sync runs **in the background** (backend side, not tied to a screen) and never blocks the UI
  or a running print.

### 9.2 Scope and ownership (confirmed)

| Data | Scope | Synced? |
|---|---|---|
| Templates (scene + document, fonts, sample data) | **Per account** | **Yes** |
| Recent jobs / history | Per device | No |
| Saved printers and printer tuning | Per device | No |
| Settings (language, startup, data guards, sync interval) | Per device | No |

Note: today `syncRegistry()` in `App.tsx` syncs the *community* mirror, the account's
publications and saved community copies. Syncing **every private template of the account** is a
new capability; check whether `server/src` already exposes it, otherwise the server needs new
endpoints (see 9.4).

### 9.3 When a sync runs

| Trigger | Notes |
|---|---|
| Right after login | Full pull; first login on a device must reach the server |
| App start / resume (if a session exists and the server is reachable) | Silent |
| **Every N minutes** | Default **5 min**; configurable in Settings → Sync (1–60); an admin default can be set at build time (e.g. `VITE_SYNC_INTERVAL_MINUTES`) |
| Connectivity regained / window focused | Debounced (~10 s) |
| After a local save or delete | Push within ~5 s (debounced) |
| **Manual "Sync" button** | Always allowed; shows the result |

Rules: one sync at a time (single-flight lock); exponential back-off on failure (30 s → 15 min
cap) so an unreachable server is not hammered; pause while the OS reports no network.

### 9.4 Sync model (so the copy stays identical)

- **Server:** each account has a monotonically increasing **revision** counter; each template has
  `id`, `revision`, `updated_at`, `deleted` flag (tombstone) and a **content hash**.
- **Pull:** "give me everything changed since revision R" → apply upserts and tombstones locally.
- **Push:** local changes (marked *dirty*, with their base revision) are sent; the server accepts
  when the base revision matches.
- **Conflicts** (changed locally and on the server): never lose data — keep the **server version**
  under the original name and save the local version as **"Name (conflict copy, date)"**, then
  tell the user. *(Confirmed.)*
- **Deletes:** synced as tombstones. The current local `deletedTemplates` list exists only to
  hide deleted shipped starters; it goes away because starters are no longer account data (R9).
- **Verification:** after each sync compare counts/hashes; if they differ, show "Local copy out of
  sync" with **Re-download all templates** in Settings → Sync.

### 9.5 User interface

- **Nav button:** a **Sync** item in the sidebar (above Settings) with icon, label and a second
  line *"Last synced 3 min ago"*; a spinner while running; a warning dot when the last run failed or
  the app is offline. On the **phone**, where the bottom bar already has five items, put a Sync icon
  button in the top bar next to the user menu (same states, `aria-live` status text).
- **Result feedback:** toast after a manual run — "Up to date", or "5 templates updated, 1
  conflict"; errors say what to do ("Server unreachable — working with local templates").
- **Header status chip:** `Online · synced` / `Offline · local data only` / `Sync error`.
- **Settings → Sync:** interval, Sync now, last result, pending local changes count, Re-download
  all templates.
- **Offline banner:** "You are offline. Printing and editing use the local copy; changes sync when
  the connection returns." Features that need the server (Publish, Community) are disabled with
  the reason shown.

### 9.6 Login, sessions and the gate (confirmed rules)

1. **No session → nothing works.** Only the sign-in / create-account screen is shown (server URL,
   name, password).
2. **Server URL prefill:** if the frontend build sets `VITE_REGISTRY_URL` (already read as
   `DEFAULT_REGISTRY_URL` in `App.tsx`), the field is **prefilled and editable**. Value order:
   the server the user last signed in to on this device, else the build default, else empty. Show a
   small "Reset to default" link when the field differs from the build value.
3. **`https://` is not required.** Plain `http://` is accepted (keep a gentle inline hint for
   non-local hosts).
4. **A saved login opens the app even when the server is unreachable** — local data only. The
   session is *not* re-validated at start. If the token turns out to be expired or revoked when a
   sync finally reaches the server, show a non-blocking banner "Sign in again to resume syncing"
   and keep the local copy usable; never lock the user out of printing because of it.
5. **Local print API and `printninja://` links do not work while logged out.** The listener on
   `127.0.0.1:17717` refuses requests (clear "Sign in to PrintNinja first" error) or is not
   started until a session exists; a deep link opened while logged out lands on the sign-in screen
   with that message and is **not queued** — the user opens the link again after signing in.
6. **Autostart / background:** the app keeps running in the background by default and the user can change that in Settings (9.9). With a saved session everything (sync, local API) is available at once; without one the tray indicates "Sign-in required".

### 9.7 Account scoping and sign-out (confirmed)

- Templates are stored keyed by **(server URL, handle)**; jobs, saved printers and settings stay
  global to the device.
- **Sign out always removes that account's templates from this device** (safe for shared PCs).
  Because a sign-out must not destroy work silently:
  1. run a **final sync** (if the server is reachable);
  2. if templates still have unsynced changes (server unreachable or sync failed), show a warning:
     *"N templates have changes that are not synced and will be lost. Sign out anyway / Cancel"*;
  3. then delete the local copy and show the gate.
- Switching accounts is sign out + sign in, so no hidden copies of another account remain.
- A **session that merely expired or was revoked is not a sign-out**: the local copy stays, the app
  keeps working offline, and the banner asks the user to sign in again (9.6).
- Consequence to accept: after sign-out, the next login needs the server and downloads all
  templates again.

### 9.8 Implementation plan (server first, then app)

**Server (`server/`) — included in the plan.** Today the server stores accounts, sessions and
*published* templates only (`/v1/account`, `/v1/login`, `/v1/templates` gallery, `/v1/saved`,
`/v1/changes`). Private templates exist only on each device. New, separate from publishing:

```sql
-- migrations/0002_account_templates.sql  (idempotent, portable SQLite, like 0001)
CREATE TABLE IF NOT EXISTS account_templates (
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id          TEXT NOT NULL,            -- client-generated template id
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    track       TEXT NOT NULL,            -- 'scene' | 'document'
    template    TEXT NOT NULL,            -- JSON (fonts included)
    sample      TEXT NOT NULL,
    revision    INTEGER NOT NULL,         -- account-wide revision of the last change
    deleted     INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS account_templates_rev ON account_templates (owner_id, revision);
CREATE TABLE IF NOT EXISTS account_revisions (
    owner_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_revision INTEGER NOT NULL
);
```

| Endpoint (authenticated with the existing session token) | Purpose |
|---|---|
| `GET /v1/sync/templates?since=R` | Everything changed after revision `R` (upserts and tombstones) plus the account's current revision |
| `POST /v1/sync/templates` | Push a batch of changes, each with its `base_revision`; response lists accepted items (new revision) and **conflicts** (with the server's current version) |
| `DELETE /v1/sync/templates/:id?base_revision=R` | Tombstone one template |

Server rules: every accepted change increments the account's revision inside one transaction;
payload limits (a template can embed fonts of up to 2 MB each); tombstones kept long enough for
slow devices (or a "full resync" response when the cursor is too old); publish/unpublish and the
public `/v1/changes` feed stay untouched; add router tests and extend `e2e.py`.

**Desktop/Android app (`app/src`).**
- A `sync` module: scheduler, single-flight lock, back-off, `sync_now`, `sync_status`,
  `set_sync_interval`; emits `sync://state` events to the UI.
- Local template table gains `account_key`, `revision`, `dirty`, `deleted`, `hash`.
- Gate: no session -> no templates, no local API listener (9.6).

**UI (`app/ui`).**
- `useSync()` hook (state, lastSyncedAt, error, `syncNow()`); Sync nav item (top-bar icon on the
  phone); Settings -> Sync; gate screen; sign-out dialog with the unsynced warning; New template
  picker (R9); remove the optional sign-in dialog and signed-out branches from `App.tsx`.

**Tests.**
- E2E against the virtual printer with the **server stopped**: printing must still succeed.
- Conflict (keep both), delete/tombstone, two devices converging to identical copies.
- Sign-out removal with and without unsynced changes; expired token keeps local data.
- API/deep link refused while logged out.

### 9.9 Background running (confirmed: on by default, user can change it)

**Today:** on desktop the window's close button *always* hides the app to the tray, and the tray
menu's "Quit PrintNinja" is the only way out (`app/src/lib.rs`, the `CloseRequested` handler;
`docs/FEATURES.md` "Close to tray"). Autostart is a separate switch whose description wrongly ties the
tray behaviour to it. There is no setting for the close behaviour.

**New behaviour:** keep this as the **default**, but make it a per-device setting.

| Item | Specification |
|---|---|
| Setting | Settings → General → **Keep running in the background** (switch, **on by default**), stored per device (`background.keep_running`) |
| Helper text | "When on, closing the window hides PrintNinja to the system tray, so templates keep syncing and the local print API stays available. When off, closing the window quits the app." |
| On (default) | Close button hides the window; process, tray icon, sync scheduler and local API keep running |
| Off | Close button quits the app (no tray icon needed); sync and the local API stop with it |
| First close with the setting on | One-time notice: "PrintNinja is still running in the tray. You can change this in Settings → General." with *Don't show again* |
| Quit | Tray menu **Quit PrintNinja** always quits fully. If a print is running or templates have unsynced changes, ask first ("Quit anyway?") |
| Tray menu | **Show PrintNinja**, **Sync now**, status line (*Signed in as <name> · Last synced 3 min ago* / *Offline — local data only* / *Sign-in required*), **Quit** |
| Tray tooltip / icon | Shows the sync state (idle, syncing, error/offline dot) |
| Sign-out while in background | Stops sync, local API refuses requests, tray shows *Sign-in required* (9.6, 9.7) |
| Autostart | Independent switch. Suggested sub-option, shown when autostart is on: **Start hidden in the tray** (the roadmap lists "start minimized" as a later item) |
| Android | No tray. Background work there is the planned **background print service** (foreground notification); hide this setting on Android until that service exists |

**Why it matters for the other requirements**
- The 5-minute sync (9.3) and the local print API on `127.0.0.1:17717` only work while the process
  is alive, so the default must stay "on" for a print-heavy desktop. If a user turns it off,
  third-party apps and `printninja://` links will only work while the window is open; document this
  next to the switch.
- A deep link arriving while the app is not running launches it; with no saved session it lands on
  the gate (9.6).

**Implementation:** read the setting into backend state at start and update it when it changes, so
the `CloseRequested` handler can choose `hide()` or exit without querying storage; add the switch
and copy to `settings-screen.tsx` and both locale files; correct the autostart description
("Start PrintNinja when you sign in") so it no longer claims tray behaviour; add tray-menu items
(Sync now, status) in `lib.rs`; add a test for close-with-setting-on/off and for the quit warning.

## 10. Final decisions

| Question | Decision |
|---|---|
| Is sign-in mandatory? | **Yes.** Until login nothing else works (server URL, name, password) |
| Server URL | Prefilled from the frontend build env (`VITE_REGISTRY_URL`), editable |
| Saved login with the server unreachable? | Opens the app; local data only |
| HTTPS required? | **No** |
| Templates per account or per device? | Templates per account; jobs, saved printers, settings per device |
| Local print API and `printninja://` links while logged out? | **No** |
| Sync interval | **Every 5 minutes**, configurable (1–60), plus manual Sync |
| Conflicts | **Keep both** (server version + "conflict copy") |
| Sign out | **Always removes the account's local templates**, after a final sync and an unsynced-changes warning |
| Server work | **Included**: private per-account template sync API (9.8) |
| Starter templates | Not account data; **picker for new templates: Blank or a starter** (R9) |
| "Name" in login | The unique registry **handle** |
| Sync button on the phone | **Top-bar icon** |
| Tables on the phone | Tables on desktop, flat list rows on the phone (8.6) |
| Organisation name/logo | **Fixed in the build** (8.5) |
| Palette | Primary `#24345B`, Secondary `#52678D`, Accent `#B49A76`, Background `#F3F0EA`, Surface `#FFFFFF`, Text `#34383D` (+ derived dark set, 8.4) |
| Dark theme | **Kept**, derived from the palette; Light / Dark / Follow system |
| Background running | **On by default** (close hides to the tray); user can switch it off in Settings → General (9.9) |

### Risks carried forward (not decided here)

1. **Forgotten password:** the server has change-password for signed-in users but no reset for a
   locked-out one. With mandatory login this means being locked out of the app. Needs a policy
   (admin reset, recovery code) before release.
2. **Passwords over plain `http://`** are accepted by decision; credentials are readable on the
   network. Keep the inline hint for non-local servers and revisit before a wide rollout.
3. **Sign-out data loss:** the warning dialog is the only protection for unsynced edits.
4. **Local API refusal while logged out** needs a clear error for integrators and a documented
   change in `docs/FEATURES.md` / `PRINT_FROM_PHONE.md`.
5. **Large templates** (embedded fonts) increase sync payloads; the server limits and a delta
   push (changed templates only) are part of 9.8.
