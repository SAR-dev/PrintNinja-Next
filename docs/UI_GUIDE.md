# 🖥️ UI Guide

> **Who this is for** — you, the person running PrintNinja on a Windows or
> Linux PC. No developer hat needed.
>
> **What you will know after reading** — every screen the app has, what every
> button does, and the words the app uses when a job comes out one way or
> another.

Everything below is the app as it is today, with the labels the app actually
shows.

## 🗺️ The app at a glance

Five screens, connected like pages:

| Screen            | What it is                                                          |
| ----------------- | ------------------------------------------------------------------- |
| **Template list** | The home screen: your templates, recent jobs, the Community tab.    |
| **Print**         | Pick a printer, enter the data, press Print.                        |
| **Scene editor**  | Build a template by placing elements on a canvas.                   |
| **Document editor** | Write an HTML/CSS template, one record per page.                  |
| **Settings**      | Five tabs: General, Printers, Network, Data, Registry.             |

No menus, no sidebar — the topbar of the list and a `← Templates` (or
`Back`) button on the other screens do all the navigating. Two kinds of
templates exist, fixed by the template's format: **scene** (elements placed
in millimetres on a label, roll, or page) and **document** (HTML/CSS, one
record per page, `{{field}}` bindings). Every card and editor header wears a
`scene` / `document` badge so you always know the track.

## ⬆️ The topbar (on the template list)

Left to right:

- **Registry status chip** — a dot (green when the registry answers, grey
  when not) and `Registry online` / `Registry offline`, then your handle (or
  `not signed in`), and — only when something is queued — `· N waiting`
  (see [Community](#-community-and-saved)).
- **Update pill** — only when a newer release exists: a download icon and the
  version (e.g. `v1.2.0`); the tooltip reads `Update to v1.2.0 (opens the
  release page)`. Clicking opens the release page in your browser — the app
  never downloads or installs anything.
- **Sync** — replays your queued registry operations, pushes local edits,
  pulls the community list; reads `Syncing…` while working.
- **Sign in / Sign out** — your registry account (handle + password, no
  email).
- **Settings**.

The topbar lives on the list only; the other screens use `← Templates` /
`Back`.

## 📋 The template list

Heading `PrintNinja`, with *Pick a template, enter the data, print.* Three
tabs: **Mine**, **Community**, **Saved**.

**Mine** — each template is a card: the **name**, a track badge, a
`published` badge when it is live on the registry, and buttons **Unpublish**
(only while published) or **Publish**, **Edit**, **Print** (highlighted).
Edit goes to the matching editor; Print goes to the print screen with the
template chosen.

Below: **Recent jobs** — the last ten, newest first. A row shows the template
name, when it ran (`today 14:32` or `12/03 09:05`), the copy count, the
printer, and a result word in the same colours as the print screen (see
[Results](#-what-the-result-says)). Red results grow **Retry**; every
finished job has **Reprint**, which re-sends the exact same job (same
template, data, and transport).

At the bottom: normally *Templates and recent jobs are saved on this
computer.* (broken local storage turns it red and says so), and a
**New template** button — a dialog titled *New template*, *Which track does
it use? The track is fixed by the template's format.*, with **Scene — labels,
rolls and pages** (starts a 40 × 50 mm label named `New label`) and
**Document — HTML/CSS**.

## 🖨️ The print screen

Top: `← Templates`, the template's name, track badge, and description. Four
cards.

**Printer** — *From the profile set — the profile is the printer.* When you
have saved printers (Settings → **Printers**), the card starts with a
**Saved printer** picker (*Use a saved printer*) — picking a row fills in
the profile and the transport the row remembers, and you can still change
either by hand. The **Pick a printer** dropdown below it is the profile
list. A profile bundles the printer's language, media, and pacing — the
profile set *is* the printer list. After a pick the card shows
`language · media` (e.g. `zpl · label`) and, when the printer can answer
for its work, a green **can confirm** badge. Printers without it still
print — they just can't say afterwards whether it happened.

**Where the bytes go** — *The transport for this job.* Four choices:

| Transport             | Fields                                                        |
| --------------------- | ------------------------------------------------------------- |
| **Raw port (TCP)**    | `Host` (default `127.0.0.1`), `Port` (default `9100`)         |
| **IPP**               | `Address` (e.g. `http://printer:631/ipp/print`), `User` (optional) |
| **Spooler (Windows)** | `Printer queue name`                                          |
| **Bluetooth**         | `Address` (e.g. `00:11:22:33:44:55`)                          |

**Data** — *JSON (one object per record) or CSV (a header row and its rows);
`{{name}}` in the template is filled from each record's fields.* Paste the
records, press **Load from file…** (`.json` / `.csv` / `.txt`, then
`loaded <filename>`), or set the **Data URL** field with a **Method**
(GET or POST): the data is then fetched from the URL at preview and at
print, and the text box and the file go off. A URL that cannot be reached
shows a warning on the preview — the print re-fetches. Only `http`/`https`
is allowed, and private addresses are blocked by default (Settings →
**Data from a URL** → **Block private IP ranges**). **Copies** below
defaults to `1`.

**Preview** — *Every page of the prepared job — the same path as the print,
nothing touches the wire.* **Preview** (it reads `Preparing…` while working)
renders every page and shows the output path plus a count like `12
record(s) · 24 page(s) · 24 unit(s) · 18.2 KB`; if the printer's preferred
path was impossible you see *Fell back from the track's preferred path: …*.
Then **Print** (disabled until a printer is chosen; reads `Printing…` while
working).

### What the result says

The **Result** card names the outcome in one word, in colour:

| Word                  | Colour  | Meaning                                                        |
| --------------------- | ------- | -------------------------------------------------------------- |
| **Confirmed**         | green   | The printer answered for the job.                              |
| **Sent, not confirmed** | amber | The printer takes jobs but cannot say whether they printed.   |
| **Partially printed** | amber   | Some copies made it — the card adds `3 of 10 made it.`         |
| **Failed**            | red     | Did not print; the reason is written under the word.           |
| **Wrong mode suspected** | red  | The printer answered in a language other than its profile's — check the printer's mode, then try again. |

The red and partial results also appear under Recent jobs, where **Retry**
and **Reprint** offer the next step.

## ✏️ The scene editor

Top: `← Templates`, `Edit template`, the `scene` badge, the **name** field,
and **Save template** / **Preview** (`Preparing…` while working).

- **Page** — *Drag an element to move it; the numbers do the same thing.*
- **Media** — *What the template prints on.* Kind: **Label — fixed size**,
  **Roll — cut per label**, **Page — paper**, with `Width (mm)` / `Height
  (mm)` (a roll asks for `Label height (mm)` instead).
- **Elements** — *Top to bottom, the order they are drawn.* List with
  **Delete** on each; **Add element…** / **Add to row…**; empty state:
  *Nothing yet — add the first element below.* Types: text, line,
  rectangle, barcode, QR code, image, and group (rows that repeat from a
  list field).
- **Selected element** — `X (mm)` / `Y (mm)`, **Page placement** (Every /
  First / Last / Only page…), then the type's fields — e.g. text: content
  (`{{name}}` fills from the record), size, alignment, bold/italic; barcode:
  kind (Code 128, Code 39, Code 93, EAN-13, UPC-A, ITF), value, *Show text
  under the bars*; QR: size, value; group: column width, gap, **Rows from** —
  *The record field holding this group's rows (a list).*
- **Data fields** — *Every binding the template uses, declared for the
  job.* The `{{…}}` bindings as badges.
- **Preview** — *Prepared on the chosen printer, the same path as the print —
  every page of one record.* Pick a printer; same fallback warning as the
  print screen.

## 📄 The document editor

Top: `← Templates`, `Edit document`, the `document` badge, name field,
**Save template**.

- **HTML/CSS** — *One record per page; `{{field}}` fills from the record.*
  Mono editor, with `Bindings:` badges.
- **Paper** — *The page the document prints on, in millimetres.* `Width
  (mm)` / `Height (mm)`, with **A4** (210 × 297), **A5** (148 × 210),
  **Letter** (215.9 × 279.4) shortcuts.
- **Sample data** — *The records the print screen starts with; the first one
  is what the preview shows.*
- **Preview** — `210 × 297 mm — the first record, live.` — rendered live as
  you type, in a sandboxed frame.

## ⚙️ Settings

Top: **Back**, `Settings`, *How the app looks and starts, and how each
printer is paced.* Five tabs — **General** (the default), **Printers**,
**Network**, **Data**, **Registry**.

**General**

- **Appearance** — *The theme of the whole app. It comes back the same on
  the next start.* **Light** / **Dark**.
- **Language** — *The interface language. It comes back the same on the
  next start.* **English** / **日本語**.
- **Start with the computer** — *Start PrintNinja when you sign in. The app
  then lives in the tray: closing the window only hides it.* Switch:
  **Start PrintNinja at sign-in**. (In the tray, the menu offers *Show
  PrintNinja* and *Quit PrintNinja* — the window's close button only hides.)

**Printers**

- **Saved printers** — *Printers you added from a scan or by hand. Pick one
  on the print screen to fill in the profile and the transport.* Three ways
  in: **Scan system** (the queues the OS already knows — Windows' spooler
  local and connected printers, Linux' `lpstat -v` — each with its fault in
  plain words), **Scan network** (the printers that announce themselves on
  the LAN), and **Add manually** (a form: **Printer name**, **Profile**, and
  the transport's fields). A scan shows `N found` — each found row has a
  **Use** button that saves it in one click; each saved row has **Remove**.
- **Printers** — *Pacing and close delay, per printer. Leave a field empty
  to use the value the profile ships with.* One card per printer: **Chunk
  size (bytes)** (*How much goes out at a time.*), **Pause between chunks
  (ms)** (*A slow printer needs a longer pause.*), **Close delay (ms)**
  (*How long the connection stays open after the last byte.*) — and, while
  any override is set, **Reset to the profile's values**.

**Network**

- **Network** — *When on, other devices on the network can send jobs to this
  PC — each one paired by a one-time code and holding its own token. Off by
  default; the switch applies from the next start.* Switch: **Let other
  devices print to this PC**. With it on: a **Pair a device** button —
  pressing it shows a one-time code, *Enter this code on the device, before
  it runs out:*, counting down from 90 seconds — plus every paired device
  (name · platform · date) with **Revoke**. The other side of this is in
  [Print from your phone](PRINT_FROM_PHONE.md).

**Data**

- **Data from a URL** — *The print screen can fetch a job's data from a URL
  instead of typing it. The fetch is guarded: http and https only, and
  private addresses are refused by default.* Switch: **Block private IP
  ranges** — *When on, a data URL cannot reach loopback, link-local or
  private addresses — the safe default. Turn it off only when a printer or
  server on your own network serves the data (like
  `http://192.168.0.10/data.json`).*

**Registry**

- **Registry** — *The server the community templates live on. Leave it empty
  to use the server on this computer (`http://127.0.0.1:8787`).* Field:
  **Server address** — a shared one, like `https://registry.example.com`,
  the same one your team uses. *It applies at the next sync.*

That is everything the settings screen has today — the app is deliberately
small: theme, language, start behaviour, saved printers and their pacing,
network pairing, the data-URL guard, and the registry address.

## 🌍 Community and Saved

Both tabs show a **local mirror** — whatever the last sync fetched — so they
work with the network cable out:

- **Community** — *Published by everyone on the registry, as the last sync
  saw them.* Empty: *Nothing published yet, or the last sync has not run.
  Press Sync.*
- **Saved** — *The community templates your account has saved — each one
  also lives on this computer.* Empty: *Nothing saved yet. Save a template
  from the Community tab.*

A row: the template's name, track badge, `by <owner>` (plus the author's
readme line), **Open**, and **Save** / **Unsave**. **Open** works without an
account — it opens the matching editor (your local copy when saved, a fresh
editable copy when not). **Save / Unsave** need a signed-in account and are
dimmed while signed out; saving pulls the template down as an editable local
copy that shows up in **Mine** — unsaving only unflags it, the copy stays.

**Signing in** — the topbar's **Sign in** opens *Sign in to the registry*:
*A handle and a password, no email. The account is for publishing and saving
community templates.* Fields **Handle** / **Password**, switch **New here?
Create the account**; the button reads **Sign in**, or **Create and sign in**
with the switch on. **Sign out** is in the topbar; the community mirror and
saved copies stay on the computer.

**Publishing** — a card's **Publish** opens *Publish `<name>` to the
community*: *The template goes up as `<handle>`'s. Leave the slug empty and
it is drafted from the name.* Fields: **Name**, **Slug** (placeholder
*drafted from the name when empty*), **Readme** — the one-liner other people
see. **Unpublish** takes it back down.

**Offline is a state, not an error.** Every registry action — publish,
unpublish, save, unsave — is queued locally when the registry can't be
reached; **Sync** replays the queue, pushes local edits, and pulls the latest
list. While anything waits, the chip shows `· N waiting` — nothing is lost
to a dropped connection.

---

*[⬅️ Back to the README](../README.md)*
