# Troubleshooting — PrintNinja

> **Who this is for:** you, when printing did not go the way you expected.
> No terminal needed for the first sections; the building-and-testing
> one is for people who compile the app.
>
> **What you will know after reading:** which message means what, and the
> one or two things to check for each — because this app is built to say
> in plain words what went wrong, the messages are the diagnosis.

Jump to: 🖨️ [Printers](#-printers) · 💻 [The app on your PC](#-the-app-on-your-pc) ·
🌍 [The registry](#-the-registry) · 🔔 [Updates](#-updates) ·
🏗️ [Building and testing](#-building-and-testing)

---

## 🖨️ Printers

**"could not connect" when you press Print**
The app could not open a connection at all (`SendError::Connect`).
- Is the printer on, and on the same network as your PC?
- Is the address in the job right? For raw/TCP (JetDirect) that is the
  printer's IP and port 9100 by convention.
- Does the printer have raw TCP/JetDirect enabled in its settings?
- Can your machine reach it at all (`ping` the printer's IP)?

**"the printer stopped reading (send deadline)"**
The 30-second send deadline expired: the printer stopped accepting
bytes mid-job (`SendError::SendDeadline`).
- Usually a congested network, a bad cable, or a switch in between.
  Try a direct cable from the printer to the PC.
- The send is paced in chunks by the profile's send plan; if the
  printer is simply slow, a profile with a larger `pause_ms` helps.

**"the connection was closed by the printer" mid-job**
The printer reset the connection while the job was going
(`SendError::ClosedByPeer`). Printers do this when something is wrong
*on the machine*: open cover, out of paper, a jam.
- Fix the fault on the printer, then reprint. Nothing was silently
  lost: the result card tells you how many units made it.

**"Partially printed — N of M"**
The app asks the printer for its status between units, and the reply
named a fault ("it is out of paper", "its cover is open", "it is
paused"). N units were fully accepted before the fault.
- Refill the paper / close the cover / clear the fault on the printer.
- Reprint the job. The app deliberately does not blind-retry after a
  partial delivery — you decide what to send again.
- If the fault is reported *after* all units went out, the result still
  says N of N with the reason: the tail of the job may have hit it.

**"Wrong mode suspected"**
Your bytes were accepted, but the printer's reply speaks a different
dialect than the profile's language: the profile and the machine
disagree.
- Pick the right profile for that exact model. A ZPL profile against an
  ESC/POS printer (or vice versa) looks like this.
- Some printers have a physical mode switch (ZPL / ESC-POS); check the
  machine itself.

**"no headless browser found" when printing a document template**
Document-track templates are rendered by the OS's own browser
(Edge on Windows, Chromium/Chrome on Linux), and none was found.
- Install Microsoft Edge or Chromium/Chrome, or
- point the app at one with `PRINTNINJA_BROWSER=/path/to/browser`.

## 💻 The app on your PC

**Templates and settings do not persist, and commands report a failure**
At startup the app logged `the local store at … did not open`. The app
keeps running — the UI holds in-memory copies — but nothing is saved,
and the local print API did not start at all (it cannot run without a
store).
- Check that the app's data directory has space and is writable.
- Last resort: close the app, move the old `printninja.db` (and its
  `-wal`/`-shm` side files) out of the way — back it up first — and
  start again. The schema is created on open, so a fresh store is
  rebuilt by itself.

**The local print API is down — a phone on the LAN cannot reach it**
Same root cause as above: the API only starts when the store opened.
If the store is healthy, check that the phone and the PC are on the
same network and that the device is still paired (pairing can be
revoked in settings).

## 🌍 The registry

**The chip says "Registry offline"**
The app cannot reach the registry server. Offline is a *state*, not an
error: nothing is lost.
- Is the server running? `pn-server serve` (or the Docker container).
- Does the address match? Settings → Registry → *Server address*
  (default `http://127.0.0.1:8787`; the `PN_REGISTRY_URL` environment
  variable overrides it).
- Publish/save operations you did meanwhile sit in the sync queue and
  are replayed, in order, when the connection returns.

**"N waiting" that does not go away**
N operations are queued and the server is still unreachable (see
above). Once the server is reachable again, a refresh replays the
queue, oldest first, and the number drops to nothing.
- If one operation *fails* on the server, the replay stops at it: it
  stays queued (the ones behind it keep their order) and is retried on
  the next refresh.
- If the failure is a dead session (401), the app also clears the
  stored account, so the next sign-in starts clean — the queue still
  waits for it.

## 🔔 Updates

**No update badge in the top bar**
The badge is a *manual* check — once per app start, no auto-download —
and it fails silently on every problem: offline, DNS, the 10-second
fetch timeout, or the GitHub API rate limit. It also only appears when
the latest release is strictly newer than the running app.
- To update for sure: open the repository's releases page and download
  the newest installer by hand.
- Pointing the app at a self-hosted forge means rebuilding the UI with
  `VITE_UPDATE_API` and `VITE_UPDATE_REPO` — the check URL is baked in
  at build time.

## 🏗️ Building and testing

**`pnpm test:rust` fails inside the container (compile OOM, out of memory)**
By design: the Rust suite runs in a Linux container with
`CARGO_BUILD_JOBS=2` and a 6 GB memory cap, so an over-sized compile
fails fast *inside the box* instead of wedging your machine.
- `target/` lives in a named volume: only the first run compiles
  everything; later runs are fast.
- The app crate embeds `app/ui/dist`, so build the frontend first:
  `pnpm -C app/ui install && pnpm -C app/ui build`.
- A genuinely over-sized build fails in the box and should be fixed
  (that is the point of the cap) — do not raise the limit to hide it.

**`tauri build` cannot find its config, or builds the wrong thing**
The Tauri config is `app/tauri.conf.json`, not at the repo root, so a
bare `tauri build` from the root does not see it.
- From the repo root use `pnpm tauri:build` (or
  `tauri build --config app/tauri.conf.json`). The same applies to
  `tauri dev` (`pnpm tauri:dev`).

**The MSI version looks odd, or the build refuses the version**
A Windows MSI version's first number is capped at 255, so date
versions ship with a `bundle.windows.wix.version` override —
`2026.1124.3` becomes `26.11.2403` in `app/tauri.conf.json`. You do not
edit it by hand.
- The release scripts write it for date versions and remove it
  otherwise; `pnpm release` refuses a version that is not buildable.
- If the version carriers disagree and `pnpm release` stops with
  "versions are out of sync", bring them back in line with
  `pnpm version:set <current version>`, commit, then release.

**"where did the installer go?"**
The Tauri build runs from the repo root against the workspace, so the
artifacts land in `target/release/bundle/` — `msi/`, `deb/` and
`appimage/` — not in `app/`.
