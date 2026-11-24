# 🖥️ UI Guide

> **Who this is for** — you, the person running PrintNinja on a Windows or
> Linux PC or on an Android phone. No developer hat needed.
>
> **What you will know after reading** — every screen the app has, what every
> button does, and the words the app uses when a job comes out one way or
> another.

Everything below is the app as it is today, with the labels the app actually
shows.

## 🗺️ The app at a glance

Five destinations, reachable from the sidebar (PC) or the bottom tab bar
(phone):

| Destination        | What it is                                                          |
| ------------------ | ------------------------------------------------------------------- |
| **Templates**      | Your local templates — the home screen.                             |
| **Jobs**           | The last ten prints, with reprint and the job's actions.            |
| **Printers**       | Saved printers and per-printer pacing, moved out of Settings.       |
| **Community**      | Templates published on the registry, and your saved copies.         |
| **Settings**       | Appearance, language, startup, network, data guards, registry URL.  |

Print and the editors are **contextual screens** opened from a destination;
the destination you came from stays highlighted, and the phone's bottom tab
bar is hidden there. Two kinds of templates exist, fixed by the format:
**scene** (elements placed in millimetres on a label, roll, or page) and
**document** (HTML/CSS, one record per page, `{{field}}` bindings). Every
card and editor header wears a `scene` / `document` badge.

## 🧭 Navigation

**On the PC** the left sidebar groups the destinations: **Workspace**
(Templates, Jobs) and **Resources** (Printers, Community). Jobs shows a count
of remembered prints and Community a count of saved templates. **Settings**
is pinned at the bottom next to **Collapse**, which narrows the sidebar to
icons. The active row has an accent background.

The top bar has the brand and version on the left. On the right:

- **Search templates** — filters the Templates list as you type; `Ctrl/Cmd+K`
  focuses it and `Escape` clears it. It searches only, it is not a command
  palette, and it is PC-only.
- The **account menu** — an avatar with a small status dot (green when the
  registry answers, red when not) and your handle, or a person icon when
  signed out. Open it for **Sync**, **Sign in / Sign out**, the `· N waiting`
  count, and an **Update** link when a newer release exists (it opens the
  release page; the app never installs anything by itself).

**On the phone** the five destinations are a bottom tab bar with an icon and
a short label. It hides on contextual screens and while a text field has
focus, so the keyboard owns the bottom of the screen.

## 📋 Templates

Heading `PrintNinja`, with *Pick a template, enter the data, print.*

**New template** is a split button on the PC: the main half opens the format
chooser, the chevron starts a scene or document directly. On the phone it is
a small **+** button above the bottom tab bar with the same chevron menu.

Each template is a card with the name, a track badge, and a `published` badge
when it is live on the registry. It has one primary action, **Print**, an
icon-only **Edit**, and a **⋯** menu with **Publish** / **Unpublish**,
**Duplicate** and **Delete** (red). On the PC, right-clicking the card opens
the same menu. Duplicating saves a copy named `<name> copy` and tells you so.
At the bottom: *Templates and recent jobs are saved on this computer.* (or a
red local-storage error).

A search in the top bar filters these cards by name and description and
shows a match count with a **Close** button.

## 🗂️ Jobs, Printers and Community

**Jobs** — the last ten prints, newest first. A row shows the template name,
when it ran (`today 14:32` or `12/03 09:05`), the copy count, the printer and
a result badge. The row's **⋯** menu offers **Reprint**, **Retry** (enabled
for failures), **Open template** (opens the frozen template in its editor)
and **Copy reason** (enabled when the result has one). Reprint re-sends the
exact same job — same template, data and transport.

**Printers** — *Printers you added from a scan or by hand.* Scan system, scan
network or add manually; each found row has **Use**, each saved row has a
**Test print** menu (**Print text label** or **Print test page**) and
**Remove**. A test sends one tiny job through that printer's saved profile
and transport, then shows the honest result under the row. Below, one card per printer sets **Chunk size (bytes)**, **Pause
between chunks (ms)** and **Close delay (ms)**, with **Reset to the profile's
values** when any override is set.

**Community** — a local mirror of what the last sync fetched, so it works
with the network cable out. **Community** shows everything published;
**Saved** shows the templates your account saved. A row has the name, track
badge, `by <owner>`, **Open**, and **Save** / **Unsave**. Saving pulls an
editable local copy into Templates; unsaving only unflags it. **Open** works
without an account.

## 🖨️ The print screen

Top: a back arrow, the template name, track badge and description, plus a
**⋯** menu with **Edit template**, **Save as default printer** and **Clear
data** (red).

The form holds the printer picker, the transport (**Where the bytes go**:
Raw port (TCP), IPP, Spooler (Windows), Bluetooth) and the data card (paste,
**Load from file…**, or a **Data URL** with a GET/POST method). **Copies**
defaults to `1`.

**On the PC** the right column stays in view while the form scrolls. Its
**Job summary** lists the template, printer, transport, copies and — after a
preview — the page and record counts. Below it, **Preview** (eye icon) and
**Print** (printer icon, the primary action) sit together.

**On the phone** those same two actions stay in a bar fixed to the bottom of
the screen. The result appears as a status banner with an icon and the
printer's outcome.

### What the result says

| Word                    | Colour | Meaning                                                                     |
| ----------------------- | ------ | --------------------------------------------------------------------------- |
| **Confirmed**           | green  | The printer answered for the job.                                           |
| **Sent, not confirmed** | amber  | The printer takes jobs but cannot say whether they printed.                 |
| **Partially printed**   | amber  | Some copies made it — the banner adds `3 of 10 made it.`                    |
| **Failed**              | red    | Did not print; the reason is written under the word.                        |
| **Wrong mode suspected**| red    | The printer answered in another language than its profile — check its mode. |

The red and partial results also appear under Jobs, where the row's ⋯ menu
offers **Retry** and **Reprint**.

## ✏️ The scene editor

The header has a back arrow, the inline **name** field, a **Description**
field, an **unsaved dot**
while there are changes, the `scene` badge, **undo** (↩) and **redo** (↪)
icon buttons, **Save template**, **Preview**, and a **⋯** menu showing the
template size and a second **Save template** command.

- **Page** — drag an element to move it; the numbers do the same thing.
  Click to select; the selection grows eight resize handles. **Delete**
  removes it, arrow keys nudge 0.1 mm (Shift: 1 mm), Ctrl/Cmd+Z undoes. The
  **Show sample data / Show fields** switch flips between sample values and
  `{{field}}` placeholders.
- **Media** — *What the template prints on*: label, roll or page, with width
  and height (a roll asks for label height).
- **Elements** — *Top to bottom, the order they are drawn.* Rows carry a type
  icon and a **⋯** menu with **Move up**, **Move down** and **Delete**. Add
  elements from the icon toolbar. Types: text, line, rectangle, frame,
  barcode, QR, image and group; a group cannot sit in a frame.
- **Selected element** — X/Y in millimetres (relative to the frame for a
  child), page placement, and the type's own fields. On the phone this panel
  is a bottom sheet with a close button; picking an element brings the canvas
  back into view first.
- **Data fields** — the `{{…}}` bindings as badges.
- **Preview** — prepared on the chosen printer, one record, same path as
  print.

## 📄 The document editor

Back arrow, inline name, Description field, `document` badge,
**Save template**:

- **HTML/CSS** — one record per page, `{{field}}` fills from the record,
  with `Bindings:` badges.
- **Paper** — width and height in millimetres, with A4 / A5 / Letter
  shortcuts.
- **Sample data** — the records the print screen starts with.
- **Preview** — the first record rendered live in a sandboxed frame.

## ⚙️ Settings

On the PC, four tabs: **General**, **Network**, **Data**, **Registry**
(saved printers and pacing live in their own destination now). On the phone
the tab strip is gone: the same groups are one list under headings. Theme and
language use a segmented control — the selected value is filled, the other
is plain.

- **General** — **Appearance** (Light / Dark), **Language** (English /
  日本語) and **Start with the computer** (*Start PrintNinja at sign-in*).
- **Network** — *Let other devices print to this PC* (off by default), with
  **Pair a device**, a one-time code counting down from 90 seconds, and a
  **Revoke** button for each paired device. See
  [Print from your phone](PRINT_FROM_PHONE.md).
- **Data** — **Block private IP ranges**, on by default; turn it off only
  when a printer or server on your own network serves the data URL.
- **Registry** — **Server address**, the community registry's URL. Leave it
  empty for the server on this computer; changes apply at the next sync.

## 🌍 Signing in, syncing and publishing

Open the account menu to **Sign in** — *A handle and a password, no email.*
The account is for publishing and saving community templates. **Sign out**
is in the same menu; the community mirror and saved copies stay on the
computer. A card's **Publish** opens *Publish `<name>` to the community*
with **Name**, **Slug** and **Readme**; **Unpublish** takes it back down.

**Offline is a state, not an error.** Every registry action is queued locally
when the registry cannot be reached. **Sync** in the account menu replays the
queue, pushes local edits and pulls the latest list. While anything waits,
the account menu shows `· N waiting` — nothing is lost to a dropped
connection.

---

*[⬅️ Back to the README](../README.md)*
