# 📱 Print from your phone

> **Who this is for** — you, running PrintNinja on a PC, wanting a phone (or a
> till, or a script) to send jobs to it across the network.
>
> **What you will know after reading** — how a phone reaches your PC, how the
> pairing code and token work, which routes the PC answers on, what a
> `printninja://` link can carry, and what is not built yet.

There are two doors in the app for "something else wants to print":

1. **The local print HTTP API** — the phone talks to your PC over the
   network. This is the door that works today for phones.
2. **`printninja://` deep links** — a link that opens the app itself. This
   door works on a device that *has* the app installed.

Both, below.

---

## 🚪 Door one: the local print HTTP API

PrintNinja runs a small HTTP API on **port 17717**, on the PC, using the same
job pipeline the print screen uses. By default it listens on `127.0.0.1`
only — nothing off the PC can reach it.

### 1. Turn the door open

In **Settings → Network**, flip **Let other devices print to this PC** on.

- Off by default; the switch applies from the **next start** of the app.
- With it on, the API listens on the whole network (all interfaces, port
  17717) instead of `127.0.0.1`.
- From now on, a request from off the PC must carry a paired device's token
  (next section). Requests from the PC itself never need one.

### 2. 🤝 Pair the phone

The pairing is a one-time code — the phone's introduction — and a token —
its long-lived credential.

**On the PC** (Settings → Network, with the switch on):

1. Press **Pair a device**.
2. A code appears on screen — *Enter this code on the device, before it runs
   out:* — an 8-character code, shown in two groups of four, with a countdown
   from **90 seconds**.
3. The code's alphabet deliberately skips the look-alikes (`0 O 1 I`),
   because a person reads it off the screen and types it.

**From the phone**, while the code is still fresh, the phone's client posts
to the PC:

```
POST http://<pc-ip>:17717/v1/pair/claim
{ "code": "K7QM4XPD", "deviceName": "my phone", "platform": "android" }
```

- The code is upper-cased and whitespace-tolerant (`k7qm 4xpd` works).
- The answer is `201` with `{ "token": "…32 characters…", "deviceId": "…" }`.
- **Keep the token.** It is shown once — the PC stores only its SHA-256 hash,
  so it cannot be shown again. The phone keeps the plain token and sends it
  in the `X-PrintNinja-Device-Token` header on every request.
- The window is **single-use** (one code, one device), expires after 90
  seconds, and locks itself after **5 wrong codes**. A wrong code answers
  `400` with how many tries are left; a dead window answers `403` — the same
  wording whether the PC is not listening at all or the window is gone, so a
  scanner cannot tell the two apart.

**Back on the PC**, the paired device shows in the Network card as
`my phone · android · 24/11/2026`, with a **Revoke** button. Revoking stops
that token being accepted **at once** — the API checks the store on every
request — and the phone is back to being "not paired".

A device can also knock on the door first:

```
GET http://<pc-ip>:17717/v1/pair/hello
```

answers `200` with `{ "protocol": 1, "provider": "printninja",
"windowOpen": true|false }` — *this PC is a PrintNinja, and here is whether
a pairing window is open right now.* With the LAN switch off it answers `403`.

### 3. 🖨️ Send a job

```
POST http://<pc-ip>:17717/v1/print
X-PrintNinja-Device-Token: <the phone's token>
{
  "template": "BOLT M8 label",
  "printer": "Fake Label",
  "data": [{ "name": "BOLT M8" }],
  "copies": 2,
  "transport": { "kind": "tcp", "host": "192.168.2.40", "port": 9100 }
}
```

| Field       | What it is                                                              |
| ----------- | ----------------------------------------------------------------------- |
| `template`  | A saved template, by the **name** the app shows (or its id).            |
| `printer`   | A printer from the profile set, by model name (or alias).               |
| `data`      | JSON — one record, or a list of them — or a string holding JSON/CSV text. |
| `copies`    | Optional, defaults to 1, at most **1000**.                              |
| `transport` | Where the bytes go (`tcp`, `ipp`, `spooler`, `bluetooth`). When left out, the saved default for that printer is used — the setting `transport.<printer>`. |

The job is accepted **and starts running at once** — the answer is not the
result:

- `201` with `{ "jobId": "…", "status": "queued" }`.
- A request may carry an **`Idempotency-Key`** header: if the same key
  arrives twice (a till retrying a dropped reply), the second call gets `409`
  with `{ "status": "duplicate", "jobId": "…original… " }` — the same job,
  nothing printed twice.

### 4. 📡 Watch the job

| Route                     | What it does                                                        |
| ------------------------- | ------------------------------------------------------------------- |
| `GET /v1/jobs`            | The accepted jobs, newest first (the last 50).                       |
| `GET /v1/jobs/{id}`       | One job — its status (`queued`, `running`, `done`, `cancelled`) and, when finished, its report. |
| `DELETE /v1/jobs/{id}`    | Cancel a job that has not started yet (a job that is printing, done, or cancelled refuses, and says why). |
| `POST /v1/jobs/{id}/retry` | Re-run a finished job — the same frozen request.                   |
| `GET /v1/health`          | `{"status": "ok"}` — or `"degraded"` when the local store is not reachable. |
| `GET /v1/printers`        | The profile set, as the app shows it.                               |
| `GET /v1/templates`       | The saved templates — name, description, track (never the body).    |

The finished report is the app's own vocabulary: `confirmed`,
`sent_unconfirmed`, `partially_printed`, `failed`, `wrong_mode_suspected` —
the same five words the print screen shows, with a `reason` when something
went wrong.

### 5. 🔒 The gate, in one breath

- From the PC itself: always in.
- From the network, LAN off: nothing (the API isn't even listening off
  `127.0.0.1`).
- From the network, LAN on, no token or an unknown token: `401` — *this
  device is not paired with this PC.*
- The two pairing routes (`/v1/pair/hello`, `/v1/pair/claim`) are the only
  network-reachable routes that don't need a token — that is how a new
  device finds the PC.

### 6. 📵 Honest note: who is the "phone client"?

The **server side is built and tested** — every route above is in the app.
What is *not* in the repository is a phone-side app: there is no dedicated
phone UI to type the code and fire the job yet. Today, the phone side is
whatever you point at the API — a small script, `curl` from a terminal, a
kiosk page. A real Android app for PrintNinja is on the plan (phase 11),
not built. So: the door, the lock, and the pairing are ready; the phone's
shoes are still being made.

---

## 🔗 Door two: `printninja://` deep links

A link like this:

```
printninja://print?template=BOLT%20M8%20label&printer=Desk&copies=3
```

hands the **app** a print request. A web page, a message, or the shell can
deliver it; if PrintNinja is already running, a second copy of the app started
by the link forwards the URL to the running one and exits.

What the link can carry — all optional:

| Param      | Meaning                                                       |
| ---------- | ------------------------------------------------------------- |
| `template` | A template, by the **name** the app shows it.                 |
| `printer`  | A printer, by the profile's **model name**.                   |
| `copies`   | A number. A value that isn't a number is dropped, not an error. |

Two rules to know:

- **Prefill only.** The link never prints by itself. It opens the **print
  screen** with the printer and copies filled in, and the person there sees
  exactly what will print and presses **Print**. That press is the
  confirmation — it applies to every source, because a link does not carry
  the caller's identity.
- **It opens the app on the device that opens the link.** So a
  `printninja://` link is for a device that *has* PrintNinja installed (for
  example, the planned Android app opening a link from a browser). It is not
  a way to reach a PC across the network — for that, door one is the way.

When a link doesn't work out, the app says so in a red banner across the top
(with a **Dismiss** button): *That print link named no template — nothing was
prepared.* · *That print link named a template called "X", and this app does
not have it.* · *That print link could not be read: …* The same link is not
re-dispatched on top of itself (the last 20 per run are remembered).

---

## ✅ You stay in control

- The LAN switch is **off by default**, and flipping it applies at the next
  start.
- Every device holds its **own** token, paired by a code that dies in 90
  seconds — no shared password, no account.
- **Revoke** a device any time; its token stops working at once.
- Revoking and the LAN switch together mean a phone can go from "trusted
  till" back to "just another device on the network" without touching
  anything else.

---

*[⬅️ Back to the README](../README.md)*
