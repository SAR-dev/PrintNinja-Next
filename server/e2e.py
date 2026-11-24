#!/usr/bin/env python3
"""The community registry's end-to-end test over plain HTTP.

Walks the full lifecycle an app uses against a *running* server:
create an account, log in, publish a template, find it in the
gallery, fetch it, save it, watch the change feed (including the
tombstone), unpublish it, and log out. CI runs it against the Docker
image on a localhost port; locally:

    python3 server/e2e.py http://127.0.0.1:8787

Only the standard library is used, so any runner with python3 can run
it. A failed assertion prints the offending request and exits
non-zero.
"""

import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"
HANDLE = "e2e-bot"
PASSWORD = "e2e-password-123"
SLUG = "e2e-template"

# A minimal valid scene template (plan phase 9, the same fixture the
# server tests use).
TEMPLATE = {
    "media": {"kind": "label", "width_mm": 58.0, "height_mm": 40.0},
    "fields": [{"name": "name"}],
    "elements": [
        {
            "type": "text",
            "at": {"x_mm": 2.0, "y_mm": 2.0},
            "size": {"w_mm": 50.0, "h_mm": 6.0},
            "content": "Hi {{name}}",
            "style": {"size_mm": 5.0},
        }
    ],
}

PUBLISHED = 0


def request(method, path, body=None, token=None, expect=None):
    """One HTTP call. Checks the status code, returns the JSON body."""
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as res:
            status, payload = res.status, json.load(res)
    except urllib.error.HTTPError as e:
        status, payload = e.code, json.load(e)
    if expect is not None and status != expect:
        sys.exit(f"FAILED: {method} {path} -> {status} (expected {expect}): {payload}")
    return payload


def check(cond, msg):
    if not cond:
        sys.exit(f"FAILED: {msg}")


# 1. The server is up.
health = request("GET", "/v1/health", expect=200)
check(health.get("status") == "ok", f"health: {health}")
print("ok  health")

# 2. Register an account by handle; the response carries a session.
acct = request(
    "POST", "/v1/account", {"handle": HANDLE, "password": PASSWORD}, expect=201
)
check(acct.get("handle") == HANDLE, f"account handle: {acct}")
token = acct["token"]
print("ok  account created")

# 3. A wrong password is rejected, exactly like an unknown handle.
request(
    "POST",
    "/v1/login",
    {"handle": HANDLE, "password": "wrong-password-1"},
    expect=401,
)
print("ok  wrong password rejected")

# 4. Logging in again mints a fresh session.
login = request("POST", "/v1/login", {"handle": HANDLE, "password": PASSWORD}, expect=201)
token = login["token"]
me = request("GET", "/v1/me", token=token, expect=200)
check(me.get("handle") == HANDLE, f"me: {me}")
print("ok  login")

# 5. Publish a template: 201 on the first write...
pub = request(
    "POST",
    "/v1/templates",
    {"name": "E2E Template", "slug": SLUG, "template": TEMPLATE},
    token=token,
    expect=201,
)
check(pub.get("created") is True, f"publish: {pub}")
check(pub.get("owner") == HANDLE, f"publish owner: {pub}")
PUBLISHED = 1
print("ok  published (created)")

# ...and 200 with created:false on a replay of the same slug — the
# offline-edit push path.
pub2 = request(
    "POST",
    "/v1/templates",
    {"name": "E2E Template", "slug": SLUG, "template": TEMPLATE},
    token=token,
    expect=200,
)
check(pub2.get("created") is False, f"republish: {pub2}")
PUBLISHED = 2
print("ok  republished (updated)")

# 6. The gallery is public: the template is findable without signing in.
# `q` searches name, readme and owner handle (not the slug), so search
# by the published name.
gallery = request("GET", "/v1/templates?q=E2E%20Template", expect=200)
check(gallery.get("total") == 1, f"gallery total: {gallery}")
check(gallery["items"][0]["slug"] == SLUG, f"gallery items: {gallery['items']}")
check(gallery["items"][0]["track"] == "scene", f"gallery track: {gallery['items']}")
print("ok  gallery search")

# 7. Fetching one template returns the full record; the document is
# the `template` string inside it. The registry stores the
# *normalized* document (parsed back through the scene schema, with
# defaults filled in), so compare the content, not the raw bytes.
fetched = request("GET", f"/v1/templates/{HANDLE}/{SLUG}", expect=200)
doc = json.loads(fetched["template"]["template"])
check(
    doc.get("media") == {"kind": "label", "width_mm": 58.0, "height_mm": 40.0},
    f"fetched media: {doc.get('media')}",
)
check([f.get("name") for f in doc.get("fields", [])] == ["name"], f"fetched fields: {doc}")
el = (doc.get("elements") or [{}])[0]
check(
    el.get("type") == "text" and el.get("content") == "Hi {{name}}",
    f"fetched element: {el}",
)
check(fetched["template"]["track"] == "scene", f"fetch track: {fetched['template']}")
print("ok  fetch")

# 8. Saving it lands on the account's saved list.
request("POST", f"/v1/templates/{HANDLE}/{SLUG}/save", token=token, expect=200)
saved = request("GET", "/v1/saved", token=token, expect=200)
check(saved.get("total") == 1, f"saved total: {saved}")
check(saved["items"][0]["slug"] == SLUG, f"saved items: {saved['items']}")
print("ok  saved")

# 9. The change feed is public, strictly ordered by seq: the create and
# the update so far, neither deleted.
changes = request("GET", "/v1/changes?since=0", expect=200)
items = changes["items"]
check(len(items) == PUBLISHED, f"changes: {len(items)} items, expected {PUBLISHED}")
check(all(not i["deleted"] for i in items), f"changes: {items}")
check([i["seq"] for i in items] == sorted(i["seq"] for i in items), "changes not ordered by seq")
print("ok  change feed")

# 10. Unpublishing (owner only) appends a tombstone: the template is
# gone from the gallery and the feed says so.
request("DELETE", f"/v1/templates/{HANDLE}/{SLUG}", token=token, expect=200)
request("GET", f"/v1/templates/{HANDLE}/{SLUG}", expect=404)
changes = request("GET", "/v1/changes?since=0", expect=200)
items = changes["items"]
check(len(items) == PUBLISHED + 1, f"changes after unpublish: {len(items)} items")
tomb = items[-1]
check(tomb["deleted"] is True, f"tombstone: {tomb}")
# A tombstone carries no documents (the empty fields are omitted).
check(
    tomb["slug"] == SLUG
    and tomb.get("template", "") == ""
    and tomb.get("sample", "") == "",
    f"tombstone: {tomb}",
)
print("ok  unpublish + tombstone")

# 11. Logging out revokes the session; it no longer works.
request("POST", "/v1/logout", token=token, expect=200)
request("GET", "/v1/me", token=token, expect=401)
print("ok  logout")

print(f"all e2e steps passed against {BASE}")
