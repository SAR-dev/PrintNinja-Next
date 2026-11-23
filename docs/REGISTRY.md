# 🌍 The community registry

Share the templates you make. The registry is a small server that holds
published templates: anyone can browse and search them, anyone with an
account can publish their own, and you can save other people's templates
into your app as editable local copies.

This guide has two halves: **using** the registry from the app, and
**hosting** one yourself.

---

## 🙋 Part 1 — using it

### Signing in (or making an account)

The registry uses **a handle and a password — no email**.

- 🏷️ **Handle:** 1–32 characters; letters, digits, underscore or hyphen. It is how other people find and save your templates, so pick one you are happy to share.
- 🔑 **Password:** at least 8 characters.
- ⚠️ **There is no password-reset flow.** If you lose your password, you need a new handle — so write the password down somewhere safe.

In the app: the **Community** tab of the template list has a *Sign in*
button. One dialog does both jobs — sign in with an existing handle, or
turn on *New here? Create the account* and the button becomes
*Create and sign in*. While you are signed out you can still browse and
search the gallery; saving and publishing need a session.

### Publishing your own template

1. Make (or open) a local template.
2. On its card, press **Publish**. Not signed in? The sign-in dialog comes first.
3. Give it a name and it is up — the registry checks the template against the scene (or HTML) schema, but never renders or prints it.

Re-publishing the same template is an **update**, not a conflict: that is
how the app pushes edits it made offline. **Unpublish** removes it from
the gallery for everyone; your local copy is untouched.

### Browsing, saving, offline

- 🔎 **Community tab:** browse and search the gallery (`q=`, by name or
  owner). No sign-in needed to look around.
- 💾 **Save** downloads the full document into your local library as an
  editable template — from then on it is yours, offline and forever.
  **Saved tab** is your list; unsave removes the local copy.
- 📴 **Offline-first:** when you are disconnected, publishing is queued
  on the device and the app syncs when the connection returns — new
  changes come down, your queue goes up, and templates that were
  unpublished in the meantime are dropped locally (the registry tells
  the app exactly which ones, one by one).

### Pointing at a shared server

👉 Settings → **Registry** → *Server address*. Type any registry URL —
`http://127.0.0.1:8787` for one running on this machine, or a shared
server like `https://registry.example.com`. Everyone on the team points
at the same URL and sees the same gallery.

---

## 🏠 Part 2 — hosting one

The registry is a single Rust binary (`pn-server`) with a SQLite
database — one file, no other services. SQL is kept portable on purpose
(a hosted SQLite backend like [Turso](https://turso.tech/) works).

### 🐳 With Docker (the recommended way)

```sh
# The image is built by CI on every push to main:
docker pull ghcr.io/<your-org>/printninja-server:latest

# Or build it from a checkout:
docker build -f server/Dockerfile -t printninja-server .

# Run it; the database lives in the volume, the migrations are inside the image:
docker run -d --name printninja-server \
  -p 8787:8787 \
  -v registry-data:/data \
  printninja-server
```

That is all. On first start the server applies its migrations itself.

🔐 **Put it behind TLS** (a reverse proxy, or your host's load
balancer) and point apps at the `https://` URL — the app's registry
setting takes any URL. Plain `http://` is fine on a trusted LAN.

### 🐍 Terminal database commands

The same commands work from the shell *and* from inside a running
container (`docker exec printninja-server <command>`):

| Command | What it does |
|---|---|
| `pn-server migrate status` | Which migrations are applied and which are waiting. |
| `pn-server migrate make <name>` | Write the next numbered `NNNN_name.sql` file, ready to edit. |
| `pn-server migrate apply` | Run every file not applied yet — one transaction per file; a failure rolls back only itself. |
| `pn-server db reset` | Delete the database and rebuild it from every migration, in order. ⚠️ Stop the server first, and yes, this deletes the data. |

Migrations are plain portable SQLite files in `server/migrations/`;
applied files are recorded in `schema_migrations`. A new deployment
always knows exactly which schema it runs, because the files ship with
the image.

### ⚙️ Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `PN_SERVER_BIND` | `127.0.0.1:8787` | Where to listen. The Docker image sets `0.0.0.0:8787`. |
| `PN_SERVER_DB` | `printninja-server.db` | The database file. The Docker image sets `/data/printninja-server.db`. |
| `PN_SERVER_MIGRATIONS_DIR` | `./migrations`, then `./server/migrations` | Where the migration files live. The Docker image sets `/app/migrations`. |

### 📡 The HTTP surface (for building your own client)

All bodies are JSON; a signed-in call sends `Authorization: Bearer <token>`.

| Call | What it does |
|---|---|
| `GET /v1/health` | Liveness. |
| `POST /v1/account` `{handle, password}` | Register; returns a session token. |
| `POST /v1/login` `{handle, password}` | Sign in; returns a session token. Wrong credentials get the same 401 as an unknown handle — handles cannot be probed. |
| `POST /v1/logout` | Revoke this session (idempotent). |
| `GET /v1/me` | The signed-in handle. |
| `POST /v1/password/change` `{currentPassword, newPassword}` | Change the password; revokes every other session. |
| `POST /v1/handle` `{handle}` | Rename the account's handle. |
| `POST /v1/templates` `{name, slug, readme?, template, sample?}` | Publish (scene or HTML document; the document is schema-checked, never rendered). First write → `201 created:true`, replay of the same slug → `200 created:false`. |
| `GET /v1/templates?q=&track=&limit=&offset=` | Browse/search the gallery. Public. |
| `GET /v1/templates/{owner}/{slug}` | One template, full document. Public. |
| `DELETE /v1/templates/{owner}/{slug}` | Unpublish (owner only). Appends a tombstone to the change feed. |
| `POST /v1/templates/{owner}/{slug}/save` · `DELETE …` | Save / unsave on your account (idempotent). |
| `GET /v1/saved` | Your saved templates, with full documents. |
| `GET /v1/changes?since=&limit=` | The change feed: every publish, update and tombstone, strictly ordered by `seq`. Public — this is what offline sync walks. |

### 🚨 Upgrading

Pull the new image and re-run the container. On first start the server
applies whatever migrations are pending — existing databases are
upgraded in place, one transaction per file. (And `db reset` is the
nuclear option when you want a clean slate, not an upgrade.)
