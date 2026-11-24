//! The community registry client and the offline-first sync engine
//! (plan phase 9, increment E). The app talks to a `pn-server`
//! registry: it signs in by handle, publishes local templates, saves
//! community templates as editable local copies, and keeps its local
//! mirror of the community in step with the registry's change feed —
//! replaying the operations it queued while offline when the
//! connection returns.
//!
//! Everything the registry says comes back as JSON with an `error`
//! field on a failure, and the session is a Bearer token the server
//! mints at sign-in. The client never guesses: a failure is the
//! registry's own words, or "unreachable" when there is no registry at
//! all.

use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::store::{CommunityTemplate, Publication, Store};

/// The registry's base URL when nothing is configured: the server's
/// own local default.
pub const DEFAULT_BASE: &str = "http://127.0.0.1:8787";

/// The settings keys this module keeps: the stored session, the feed
/// cursor, and the base URL override.
pub const ACCOUNT_KEY: &str = "registry.account";
pub const CURSOR_KEY: &str = "registry.cursor";
pub const URL_KEY: &str = "registry.url";

/// How long one call to the registry may take before it is the
/// connection, not the registry, that is slow.
const CALL_TIMEOUT: Duration = Duration::from_secs(10);
/// One page of the change feed.
const FEED_PAGE: u32 = 500;
/// One page of the saved list.
const SAVED_PAGE: u32 = 100;

/// What the app has to talk to the registry with: the session token and
/// the handle the registry serves it as. Stored in the settings, so the
/// session outlives the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub handle: String,
    pub token: String,
    /// When the session stops working (Unix seconds).
    pub expires_at: i64,
}

/// What a refresh found: who is signed in, whether the registry
/// answers, and how many operations are still queued for it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryStatus {
    pub handle: Option<String>,
    pub online: bool,
    pub pending: u64,
}

/// A failure the registry did not make: the call never got through.
#[derive(Debug)]
pub enum ClientError {
    /// The call never reached the registry (no server, wrong port, no
    /// network).
    Unreachable(String),
    /// The registry answered, and it refused: its status and words.
    Status(u16, String),
}

impl ClientError {
    /// The words for the UI.
    pub fn message(&self) -> String {
        match self {
            ClientError::Unreachable(e) => format!("cannot reach the registry: {e}"),
            ClientError::Status(s, msg) => {
                if msg.is_empty() {
                    format!("the registry answered with status {s}")
                } else {
                    msg.clone()
                }
            }
        }
    }
}

impl From<ClientError> for String {
    fn from(e: ClientError) -> Self {
        e.message()
    }
}

/// One row of the registry's change feed (plan phase 9): what the
/// mirror applies, in order, by `seq`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Change {
    seq: i64,
    owner: String,
    slug: String,
    name: String,
    readme: String,
    track: String,
    /// Empty on a tombstone.
    #[serde(default)]
    template: String,
    /// Empty on a tombstone.
    #[serde(default)]
    sample: String,
    deleted: bool,
    changed_at: i64,
}

#[derive(Debug, Deserialize)]
struct ChangesPage {
    items: Vec<Change>,
}

/// The registry's view of one saved template: the owner and slug are
/// all the flag pass needs — the document itself comes from the feed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedItem {
    owner: String,
    slug: String,
}

#[derive(Debug, Deserialize)]
struct SavedPage {
    items: Vec<SavedItem>,
}

/// The registry client: one HTTP client, the base URL, and — when
/// signed in — the account. Built per call from the app's settings, so
/// a URL or session change takes effect on the next call.
#[derive(Clone)]
pub struct Registry {
    http: reqwest::Client,
    base: String,
    /// The signed-in account, when there is one.
    account: Option<Account>,
}

/// `now` in the millisecond base the app's rows keep.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Two JSON texts are the same document: parsed, they are equal. When
/// one is not JSON at all, they are equal as text. Key order and
/// whitespace never matter — only the document.
fn same_document(a: &str, b: &str) -> bool {
    match (
        serde_json::from_str::<Value>(a),
        serde_json::from_str::<Value>(b),
    ) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

impl Registry {
    /// The base URL the client talks to: the `PN_REGISTRY_URL`
    /// environment variable, then the `registry.url` setting, then the
    /// local default. A trailing slash is trimmed, so both forms work.
    pub fn base_url(settings: &BTreeMap<String, String>) -> String {
        let from_setting = settings
            .get(URL_KEY)
            .map(String::as_str)
            .filter(|s| !s.trim().is_empty());
        let from_env = std::env::var("PN_REGISTRY_URL")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let raw = from_env.as_deref().or(from_setting).unwrap_or(DEFAULT_BASE);
        raw.trim().trim_end_matches('/').to_string()
    }

    /// The stored account, when one is signed in: the session JSON the
    /// settings keep, a blank one meaning signed out.
    pub fn stored_account(settings: &BTreeMap<String, String>) -> Option<Account> {
        settings.get(ACCOUNT_KEY).and_then(|raw| {
            if raw.trim().is_empty() {
                None
            } else {
                serde_json::from_str(raw).ok()
            }
        })
    }

    /// The feed cursor the app last applied, from the settings.
    pub fn cursor(settings: &BTreeMap<String, String>) -> i64 {
        settings
            .get(CURSOR_KEY)
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
    }

    /// Build the client from the app's settings: the base URL and the
    /// stored account.
    pub fn from_settings(store: &Store) -> Result<Registry, String> {
        let settings = store.load_settings()?;
        Ok(Self {
            http: reqwest::Client::new(),
            base: Self::base_url(&settings),
            account: Self::stored_account(&settings),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    /// Run one call. A non-2xx is the registry's own words; a call that
    /// never gets through is `Unreachable`.
    async fn send(
        &self,
        method: reqwest::Method,
        url: &str,
        token: Option<&str>,
        body: Option<&Value>,
    ) -> Result<Value, ClientError> {
        let mut req = self.http.request(method, url).timeout(CALL_TIMEOUT);
        if let Some(t) = token {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = match req.send().await {
            Ok(res) => res,
            Err(e) => return Err(ClientError::Unreachable(e.to_string())),
        };
        let status = res.status().as_u16();
        let text = res
            .text()
            .await
            .map_err(|e| ClientError::Unreachable(e.to_string()))?;
        // The registry answers in JSON, but an answer that is not JSON
        // (a bare success, a plain-text error) is kept readable rather
        // than surfacing as a decode failure: successes read as "ok",
        // failures keep their words in the error field.
        let value: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) if (200..300).contains(&status) => Value::Null,
            Err(_) => json!({ "error": text }),
        };
        if (200..300).contains(&status) {
            Ok(value)
        } else {
            let msg = value
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or_default()
                .to_string();
            Err(ClientError::Status(status, msg))
        }
    }

    /// Whether the registry answers at all — the probe every refresh
    /// starts with.
    pub async fn online(&self) -> bool {
        self.send(reqwest::Method::GET, &self.url("/v1/health"), None, None)
            .await
            .is_ok()
    }

    /// The number of operations waiting for the connection.
    pub fn pending(store: &Store) -> u64 {
        store.queued_ops().map(|ops| ops.len() as u64).unwrap_or(0)
    }

    /// What a status probe and the settings add up to, without
    /// syncing — the cheap check the header chip uses.
    pub async fn status(&self, store: &Store) -> RegistryStatus {
        let online = self.online().await;
        RegistryStatus {
            handle: self.account.as_ref().map(|a| a.handle.clone()),
            online,
            pending: Self::pending(store),
        }
    }

    /// Sign in, or create the account. The session is stored on success
    /// so the next call signs in as the same account; the account's
    /// handle, as the registry serves it, comes back.
    pub async fn login(
        &self,
        store: &Store,
        handle: &str,
        password: &str,
        create: bool,
    ) -> Result<String, String> {
        let path = if create { "/v1/account" } else { "/v1/login" };
        let body = json!({ "handle": handle, "password": password });
        let v = self
            .send(reqwest::Method::POST, &self.url(path), None, Some(&body))
            .await
            .map_err(|e| e.message())?;
        let account = Account {
            handle: v
                .get("handle")
                .and_then(|h| h.as_str())
                .ok_or("the registry returned no handle")?
                .to_string(),
            token: v
                .get("token")
                .and_then(|t| t.as_str())
                .ok_or("the registry returned no token")?
                .to_string(),
            expires_at: v.get("expiresAt").and_then(|e| e.as_i64()).unwrap_or(0),
        };
        store.save_setting(
            ACCOUNT_KEY,
            &serde_json::to_string(&account).expect("the account serializes"),
        )?;
        Ok(account.handle)
    }

    /// Sign out: the session is revoked (best effort — a dead registry
    /// does not keep the local account from going) and the stored
    /// account is cleared.
    pub async fn logout(&self, store: &Store) -> Result<(), String> {
        if let Some(account) = &self.account {
            let _ = self
                .send(
                    reqwest::Method::POST,
                    &self.url("/v1/logout"),
                    Some(&account.token),
                    None,
                )
                .await;
        }
        store.save_setting(ACCOUNT_KEY, "")
    }

    /// The whole sync (plan phase 9, offline-first), in the order the
    /// registry expects it:
    ///
    /// 1. replay the operations queued while offline, oldest first —
    ///    a failure stops the replay, so the queue never skips ahead;
    /// 2. push the local edits that are newer than what is published;
    /// 3. pull the change feed from the cursor and apply it to the
    ///    community mirror;
    /// 4. with an account, refresh which mirror rows are saved.
    ///
    /// Steps 1, 2 and 4 need a session; without one the queue and the
    /// publications simply wait, and the feed (step 3) still moves.
    /// `Unreachable` is not an error here: offline is a state, and the
    /// queue is what it is for.
    pub async fn refresh(&self, store: &Store) -> Result<RegistryStatus, String> {
        if !self.online().await {
            return Ok(RegistryStatus {
                handle: self.account.as_ref().map(|a| a.handle.clone()),
                online: false,
                pending: Self::pending(store),
            });
        }
        if self.account.is_some() {
            self.replay_queue(store).await?;
            self.reconcile_publications(store).await?;
        }
        self.pull_feed(store).await?;
        if self.account.is_some() {
            self.pull_saved(store).await?;
        }
        Ok(RegistryStatus {
            handle: self.account.as_ref().map(|a| a.handle.clone()),
            online: true,
            pending: Self::pending(store),
        })
    }

    /// Step 1: the queue, oldest first. The first failure stops the
    /// replay — the operations after it keep their order for the next
    /// refresh, and a dead session drops the stored account so the next
    /// sign-in can start clean.
    async fn replay_queue(&self, store: &Store) -> Result<(), ClientError> {
        let ops = store.queued_ops().map_err(ClientError::Unreachable)?;
        for op in ops {
            match self.apply_op(store, &op).await {
                Ok(()) => store
                    .drop_queued_op(op.id)
                    .map_err(ClientError::Unreachable)?,
                Err(e) => {
                    if matches!(e, ClientError::Status(401, _)) {
                        let _ = store.save_setting(ACCOUNT_KEY, "");
                    }
                    return Err(e);
                }
            }
        }
        Ok(())
    }

    /// One queued operation against the registry, and its local
    /// effect once it succeeds — the single place an operation's local
    /// state is written.
    async fn apply_op(
        &self,
        store: &Store,
        op: &crate::store::QueuedOp,
    ) -> Result<(), ClientError> {
        let token = self.account.as_ref().map(|a| a.token.as_str());
        let call: Result<(), ClientError> = match op.kind.as_str() {
            "publish" => {
                let body: Value = serde_json::from_str(&op.payload)
                    .map_err(|e| ClientError::Unreachable(format!("a bad queued publish: {e}")))?;
                self.send(
                    reqwest::Method::POST,
                    &self.url("/v1/templates"),
                    token,
                    Some(&body),
                )
                .await
                .map(|_| ())
            }
            "unpublish" => {
                let p: Value = serde_json::from_str(&op.payload).map_err(|e| {
                    ClientError::Unreachable(format!("a bad queued unpublish: {e}"))
                })?;
                let path = op_path(&p, "the queued unpublish")?;
                self.send(reqwest::Method::DELETE, &self.url(&path), token, None)
                    .await
                    .map(|_| ())
            }
            "save" | "unsave" => {
                let p: Value = serde_json::from_str(&op.payload)
                    .map_err(|e| ClientError::Unreachable(format!("a bad queued save: {e}")))?;
                // The save lives on its own sub-path of the template's.
                let path = format!("{}/save", op_path(&p, "the queued save")?);
                let method = if op.kind == "save" {
                    reqwest::Method::POST
                } else {
                    reqwest::Method::DELETE
                };
                self.send(method, &self.url(&path), token, None)
                    .await
                    .map(|_| ())
            }
            other => {
                return Err(ClientError::Unreachable(format!(
                    "a queued operation of kind {other:?}"
                )))
            }
        };
        call.and_then(|()| {
            self.apply_local(store, op)
                .map_err(ClientError::Unreachable)
        })
    }

    /// The local effect of a successful operation.
    fn apply_local(&self, store: &Store, op: &crate::store::QueuedOp) -> Result<(), String> {
        let ms = now_ms();
        match op.kind.as_str() {
            "publish" => {
                let p: Value = serde_json::from_str(&op.payload).map_err(|e| e.to_string())?;
                let local_id = p
                    .get("localTemplateId")
                    .and_then(|v| v.as_str())
                    .ok_or("the queued publish has no local template")?;
                let base = store
                    .publication_for_local(local_id)?
                    .unwrap_or(Publication {
                        id: uuid::Uuid::new_v4().to_string(),
                        local_template_id: local_id.to_string(),
                        owner: self
                            .account
                            .as_ref()
                            .map(|a| a.handle.clone())
                            .unwrap_or_default(),
                        slug: String::new(),
                        name: String::new(),
                        readme: String::new(),
                        last_template: String::new(),
                        last_sample: String::new(),
                        published_at: ms,
                    });
                store.upsert_publication(&Publication {
                    name: p
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    slug: p
                        .get("slug")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    readme: p
                        .get("readme")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    // The exact text the app sent, so the stale check
                    // compares what left the device, not what the
                    // registry re-serialized.
                    last_template: p.get("template").map(|v| v.to_string()).unwrap_or_default(),
                    last_sample: p.get("sample").map(|v| v.to_string()).unwrap_or_default(),
                    published_at: ms,
                    ..base
                })?;
            }
            "unpublish" => {
                let p: Value = serde_json::from_str(&op.payload).map_err(|e| e.to_string())?;
                for pub_ in store.publications()? {
                    if pub_.owner == p.get("owner").and_then(|v| v.as_str()).unwrap_or_default()
                        && pub_.slug == p.get("slug").and_then(|v| v.as_str()).unwrap_or_default()
                    {
                        store.delete_publication_for_local(&pub_.local_template_id)?;
                    }
                }
            }
            "save" | "unsave" => {
                let p: Value = serde_json::from_str(&op.payload).map_err(|e| e.to_string())?;
                let owner = p
                    .get("owner")
                    .and_then(|v| v.as_str())
                    .ok_or("the queued save has no owner")?;
                let slug = p
                    .get("slug")
                    .and_then(|v| v.as_str())
                    .ok_or("the queued save has no slug")?;
                if op.kind == "save" {
                    if let Some(t) = store.community_template(owner, slug)? {
                        store.set_community_saved(owner, slug, true)?;
                        self.materialize_local_copy(store, &t)?;
                    }
                } else {
                    store.set_community_saved(owner, slug, false)?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// A saved community template becomes an editable local copy in the
    /// template list: id `saved-{owner}-{slug}`, the name and the
    /// document as the registry serves them.
    fn materialize_local_copy(&self, store: &Store, t: &CommunityTemplate) -> Result<(), String> {
        let id = format!("saved-{}-{}", t.owner, t.slug);
        let name = if t.name.trim().is_empty() {
            format!("{}/{}", t.owner, t.slug)
        } else {
            t.name.clone()
        };
        let existing = store.load_templates()?.into_iter().find(|x| x.id == id);
        let base = existing.unwrap_or(crate::store::StoredTemplate {
            id: id.clone(),
            name,
            description: String::new(),
            track: t.track.clone(),
            template: String::new(),
            sample: String::new(),
        });
        store.save_template(&crate::store::StoredTemplate {
            description: if t.readme.trim().is_empty() {
                "Saved from the community".to_string()
            } else {
                t.readme.clone()
            },
            template: t.template.clone(),
            sample: t.sample.clone(),
            ..base
        })
    }

    /// Step 2: a publication whose local template has moved ahead of
    /// what went up goes up again. The comparison is document-level —
    /// key order and whitespace never make an unchanged template look
    /// stale.
    async fn reconcile_publications(&self, store: &Store) -> Result<(), ClientError> {
        let pubs = store.publications().map_err(ClientError::Unreachable)?;
        if pubs.is_empty() {
            return Ok(());
        }
        let templates = store.load_templates().map_err(ClientError::Unreachable)?;
        for pub_ in pubs {
            let Some(t) = templates.iter().find(|t| t.id == pub_.local_template_id) else {
                // The local template is gone: the registry's copy
                // stands alone. The app cannot unpublish what it no
                // longer knows, so it leaves it.
                continue;
            };
            if t.name == pub_.name
                && t.description == pub_.readme
                && same_document(&t.template, &pub_.last_template)
                && same_document(&t.sample, &pub_.last_sample)
            {
                continue;
            }
            let template: Value = serde_json::from_str(&t.template).map_err(|e| {
                ClientError::Unreachable(format!("a stored template is not JSON: {e}"))
            })?;
            let sample: Value =
                serde_json::from_str(&t.sample).unwrap_or_else(|_| Value::Array(Vec::new()));
            let body = json!({
                "name": t.name,
                "slug": pub_.slug,
                "readme": t.description,
                "template": template,
                "sample": sample,
            });
            let token = self.account.as_ref().map(|a| a.token.as_str());
            self.send(
                reqwest::Method::POST,
                &self.url("/v1/templates"),
                token,
                Some(&body),
            )
            .await
            .map_err(|e| {
                if matches!(e, ClientError::Status(401, _)) {
                    let _ = store.save_setting(ACCOUNT_KEY, "");
                }
                e
            })?;
            let ms = now_ms();
            store
                .upsert_publication(&Publication {
                    name: t.name.clone(),
                    readme: t.description.clone(),
                    last_template: template.to_string(),
                    last_sample: sample.to_string(),
                    published_at: ms,
                    ..pub_
                })
                .map_err(ClientError::Unreachable)?;
        }
        Ok(())
    }

    /// Step 3: the change feed from the cursor, page by page, applied
    /// to the mirror. The cursor moves as the pages apply, so a
    /// failure midway never loses the entries already applied.
    async fn pull_feed(&self, store: &Store) -> Result<(), ClientError> {
        let mut since = Self::cursor(&store.load_settings().map_err(ClientError::Unreachable)?);
        loop {
            let url = self.url(&format!("/v1/changes?since={since}&limit={FEED_PAGE}"));
            let v = self.send(reqwest::Method::GET, &url, None, None).await?;
            let page: ChangesPage = serde_json::from_value(v)
                .map_err(|e| ClientError::Unreachable(format!("a bad change page: {e}")))?;
            for change in &page.items {
                self.apply_change(store, change)?;
                since = since.max(change.seq);
            }
            store
                .save_setting(CURSOR_KEY, &since.to_string())
                .map_err(ClientError::Unreachable)?;
            if page.items.len() < FEED_PAGE as usize {
                break;
            }
        }
        Ok(())
    }

    /// One feed entry on the mirror: a live entry upserts (the saved
    /// flag of a row already there survives), a tombstone drops the row.
    fn apply_change(&self, store: &Store, c: &Change) -> Result<(), ClientError> {
        if c.deleted {
            store
                .drop_community_template(&c.owner, &c.slug)
                .map(|_| ())
                .map_err(ClientError::Unreachable)
        } else {
            let saved = store
                .community_template(&c.owner, &c.slug)
                .map_err(ClientError::Unreachable)?
                .map(|t| t.saved)
                .unwrap_or(false);
            store
                .upsert_community_template(&CommunityTemplate {
                    owner: c.owner.clone(),
                    slug: c.slug.clone(),
                    name: c.name.clone(),
                    readme: c.readme.clone(),
                    track: c.track.clone(),
                    template: c.template.clone(),
                    sample: c.sample.clone(),
                    changed_at: c.changed_at,
                    saved,
                })
                .map_err(ClientError::Unreachable)
        }
    }

    /// Step 4: the saved list is the registry's to say — every page of
    /// it, then the mirror's flags set to match. A row the registry
    /// says is saved gets its local copy here, too, so a save made on
    /// another device lands as an editable template on this one.
    async fn pull_saved(&self, store: &Store) -> Result<(), ClientError> {
        let Some(token) = self.account.as_ref().map(|a| a.token.as_str()) else {
            return Ok(());
        };
        let mut saved: BTreeSet<(String, String)> = BTreeSet::new();
        let mut offset: u32 = 0;
        loop {
            let url = self.url(&format!("/v1/saved?limit={SAVED_PAGE}&offset={offset}"));
            let v = self
                .send(reqwest::Method::GET, &url, Some(token), None)
                .await?;
            let page: SavedPage = serde_json::from_value(v)
                .map_err(|e| ClientError::Unreachable(format!("a bad saved page: {e}")))?;
            for item in &page.items {
                saved.insert((item.owner.clone(), item.slug.clone()));
            }
            offset += SAVED_PAGE;
            if page.items.len() < SAVED_PAGE as usize {
                break;
            }
        }
        let rows = store
            .community_templates()
            .map_err(ClientError::Unreachable)?;
        for t in rows {
            let want = saved.contains(&(t.owner.clone(), t.slug.clone()));
            if want != t.saved {
                store
                    .set_community_saved(&t.owner, &t.slug, want)
                    .map_err(ClientError::Unreachable)?;
            }
            if want {
                self.materialize_local_copy(store, &t)
                    .map_err(ClientError::Unreachable)?;
            }
        }
        Ok(())
    }
}

/// The path of an owner/slug operation: the template's endpoint, the
/// words naming the payload in an error.
fn op_path(p: &Value, which: &str) -> Result<String, ClientError> {
    let owner = p
        .get("owner")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ClientError::Unreachable(format!("{which} has no owner")))?;
    let slug = p
        .get("slug")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ClientError::Unreachable(format!("{which} has no slug")))?;
    let (owner, slug) = (urlencoding::encode(owner), urlencoding::encode(slug));
    Ok(format!("/v1/templates/{owner}/{slug}"))
}

/// A slug from a template name: lowercase, the gaps as dashes. The
/// registry checks the result itself; this is just the first draft.
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::IntoFuture;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Instant;

    /// A live registry on a throwaway port, and the app's store. The
    /// server runs as a task on the test's own runtime; a signal on
    /// the stop channel ends it.
    struct Live {
        /// The base URL the client is built with.
        base: String,
        /// A base URL that is guaranteed not to answer.
        offline_base: String,
        store: Store,
        /// The stop signal the server task listens for.
        stop: tokio::sync::mpsc::Sender<()>,
        dir: PathBuf,
    }

    impl Live {
        async fn start() -> Self {
            use pn_server::ServerState;

            let dir =
                std::env::temp_dir().join(format!("pn-registry-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).expect("the test directory creates");
            let db = dir.join("registry.db");
            let store = pn_server::store::Store::open(&db).expect("the registry store opens");
            let state = ServerState {
                store: Arc::new(store),
            };

            // A real port, bound and released: the server takes it.
            let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port binds");
            let port = listener
                .local_addr()
                .expect("the bound listener has an address")
                .port();
            drop(listener);
            let base = format!("http://127.0.0.1:{port}");

            // The server as a task on the test's runtime: it serves
            // until a stop signal arrives.
            let (stop_tx, mut stop_rx) = tokio::sync::mpsc::channel::<()>(1);
            let app = pn_server::router::router(state);
            tokio::spawn(async move {
                let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
                    .await
                    .expect("the server binds its port");
                let serve = axum::serve(listener, app).into_future();
                tokio::select! {
                    res = serve => res.expect("the server runs"),
                    _ = stop_rx.recv() => {}
                }
            });

            // Wait for the port to answer.
            let client = reqwest::Client::new();
            let started = Instant::now();
            loop {
                match client
                    .get(format!("{base}/v1/health"))
                    .timeout(Duration::from_secs(1))
                    .send()
                    .await
                {
                    Ok(_) => break,
                    Err(e) => {
                        if started.elapsed() > Duration::from_secs(10) {
                            let _ = stop_tx.send(()).await;
                            panic!("the test registry did not come up: {e}");
                        }
                    }
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }

            // A port nothing answers on: the app's offline case.
            let dead = TcpListener::bind("127.0.0.1:0").expect("a loopback port binds");
            let offline_port = dead
                .local_addr()
                .expect("the bound listener has an address")
                .port();
            drop(dead);

            let app_store = Store::in_memory().expect("the app's store opens");
            Self {
                base,
                offline_base: format!("http://127.0.0.1:{offline_port}"),
                store: app_store,
                stop: stop_tx,
                dir,
            }
        }
    }

    impl Drop for Live {
        fn drop(&mut self) {
            // Ask the server task to stop. `try_send` takes `&self`, so
            // it works from here; the task winds down on the test's
            // runtime. The directory removal is best effort — on
            // Windows the file is still briefly locked.
            let _ = self.stop.try_send(());
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// A client on `base`, the account read back from the store — the
    /// same way the app builds one.
    fn client(base: &str, store: &Store) -> Registry {
        Registry {
            http: reqwest::Client::new(),
            base: base.to_string(),
            account: Registry::stored_account(&store.load_settings().expect("the settings load")),
        }
    }

    /// A scene template that passes the registry's checks, as a JSON
    /// value — the same shape the app sends.
    fn label_doc() -> Value {
        json!({
            "media": { "kind": "label", "width_mm": 58.0, "height_mm": 40.0 },
            "fields": [ { "name": "name" } ],
            "elements": [
                {
                    "type": "text",
                    "at": { "x_mm": 2.0, "y_mm": 2.0 },
                    "size": { "w_mm": 50.0, "h_mm": 6.0 },
                    "content": "Hi {{name}}",
                    "style": { "size_mm": 5.0 }
                }
            ]
        })
    }

    /// Publish one local template (id `t1`, the label document) as
    /// `handle` owns it.
    async fn publish_one(reg: &Registry, store: &Store, handle: &str, slug: &str) {
        let t = crate::store::StoredTemplate {
            id: "t1".into(),
            name: "Shipping".into(),
            description: "labels for shipping".into(),
            track: "scene".into(),
            template: label_doc().to_string(),
            sample: r#"[{"name":"Jane"}]"#.into(),
        };
        store.save_template(&t).unwrap();
        let body = json!({
            "localTemplateId": "t1",
            "name": t.name,
            "slug": slug,
            "readme": t.description,
            "template": label_doc(),
            "sample": serde_json::from_str::<Value>(&t.sample).unwrap(),
        });
        store.enqueue_op("publish", &body.to_string(), 1).unwrap();
        reg.refresh(store).await.expect("the publish replays");
        assert_eq!(
            store
                .publication_for_local("t1")
                .unwrap()
                .expect("the publication is recorded")
                .owner,
            handle
        );
    }

    #[tokio::test]
    async fn sign_in_publishes_and_the_feed_mirrors_it() {
        let live = Live::start().await;
        let reg = client(&live.base, &live.store);
        let handle = reg
            .login(&live.store, "ana", "secretpass1", true)
            .await
            .expect("the account is created");
        assert_eq!(handle, "ana");

        // The session lives in the store; a fresh client sees it.
        let reg = client(&live.base, &live.store);

        publish_one(&reg, &live.store, "ana", "shipping").await;

        let status = reg
            .refresh(&live.store)
            .await
            .expect("the second refresh is a no-op");
        assert!(status.online);
        assert_eq!(status.handle.as_deref(), Some("ana"));
        assert_eq!(status.pending, 0, "the replayed publish leaves the queue");

        let pub_ = live
            .store
            .publication_for_local("t1")
            .unwrap()
            .expect("the publication is recorded");
        assert_eq!(pub_.owner, "ana");
        assert_eq!(pub_.slug, "shipping");

        let rows = live.store.community_templates().unwrap();
        assert_eq!(rows.len(), 1, "the feed put the mirror row there");
        assert_eq!(rows[0].owner, "ana");
        assert_eq!(rows[0].name, "Shipping");
        assert!(rows[0].template.contains("Hi {{name}}"));
        assert_eq!(
            Registry::cursor(&live.store.load_settings().unwrap()),
            1,
            "the cursor advanced to the entry it applied"
        );
    }

    #[tokio::test]
    async fn a_second_account_saves_and_the_flag_follows_the_registry() {
        let live = Live::start().await;
        let reg = client(&live.base, &live.store);
        reg.login(&live.store, "ana", "secretpass1", true)
            .await
            .unwrap();
        // The session lives in the store; a fresh client sees it.
        let reg = client(&live.base, &live.store);
        publish_one(&reg, &live.store, "ana", "shipping").await;

        // john signs in on the same device.
        reg.logout(&live.store).await.unwrap();
        let reg = client(&live.base, &live.store);
        let handle = reg
            .login(&live.store, "john", "secretpass1", true)
            .await
            .unwrap();
        assert_eq!(handle, "john");
        let reg = client(&live.base, &live.store);

        // john saves ana's template.
        let body = json!({ "owner": "ana", "slug": "shipping" });
        live.store.enqueue_op("save", &body.to_string(), 1).unwrap();
        reg.refresh(&live.store).await.expect("the save replays");

        let row = live
            .store
            .community_template("ana", "shipping")
            .unwrap()
            .expect("the mirror row is there");
        assert!(row.saved, "the saved flag is set");
        let copies = live.store.load_templates().unwrap();
        assert!(
            copies.iter().any(|c| c.id == "saved-ana-shipping"),
            "the saved template is a local copy: {:?}",
            copies.iter().map(|c| c.id.as_str()).collect::<Vec<_>>()
        );

        // john unsaves: the flag falls, the copy stays.
        live.store
            .enqueue_op("unsave", &body.to_string(), 2)
            .unwrap();
        reg.refresh(&live.store).await.expect("the unsave replays");
        assert!(
            !live
                .store
                .community_template("ana", "shipping")
                .unwrap()
                .unwrap()
                .saved
        );
        assert!(live
            .store
            .load_templates()
            .unwrap()
            .iter()
            .any(|c| c.id == "saved-ana-shipping"));
    }

    #[tokio::test]
    async fn offline_ops_queue_and_replay_when_the_connection_returns() {
        let live = Live::start().await;
        let reg = client(&live.base, &live.store);
        reg.login(&live.store, "ana", "secretpass1", true)
            .await
            .unwrap();

        // The connection drops: the client points at a dead port.
        let offline = client(&live.offline_base, &live.store);
        let t = crate::store::StoredTemplate {
            id: "t9".into(),
            name: "Offline".into(),
            description: "queued offline".into(),
            track: "scene".into(),
            template: label_doc().to_string(),
            sample: "[]".into(),
        };
        live.store.save_template(&t).unwrap();
        let body = json!({
            "localTemplateId": "t9",
            "name": t.name,
            "slug": "offline",
            "readme": t.description,
            "template": label_doc(),
            "sample": Value::Array(Vec::new()),
        });
        live.store
            .enqueue_op("publish", &body.to_string(), 1)
            .unwrap();

        let status = offline
            .refresh(&live.store)
            .await
            .expect("offline is a state, not an error");
        assert!(!status.online);
        assert_eq!(status.pending, 1, "the operation stayed queued");

        // The connection returns: the same queue, the real registry.
        let reg = client(&live.base, &live.store);
        let status = reg.refresh(&live.store).await.expect("the replay succeeds");
        assert!(status.online);
        assert_eq!(status.pending, 0, "the queue is empty");
        assert!(
            live.store.publication_for_local("t9").unwrap().is_some(),
            "the publication is recorded"
        );
    }

    #[tokio::test]
    async fn unpublishing_applies_the_tombstone_to_the_mirror() {
        let live = Live::start().await;
        let reg = client(&live.base, &live.store);
        reg.login(&live.store, "ana", "secretpass1", true)
            .await
            .unwrap();
        // The session lives in the store; a fresh client sees it.
        let reg = client(&live.base, &live.store);
        publish_one(&reg, &live.store, "ana", "shipping").await;
        assert_eq!(live.store.community_templates().unwrap().len(), 1);

        let body = json!({ "owner": "ana", "slug": "shipping" });
        live.store
            .enqueue_op("unpublish", &body.to_string(), 1)
            .unwrap();
        reg.refresh(&live.store)
            .await
            .expect("the unpublish replays");

        assert!(
            live.store
                .community_template("ana", "shipping")
                .unwrap()
                .is_none(),
            "the tombstone dropped the mirror row"
        );
        assert!(live.store.publication_for_local("t1").unwrap().is_none());
    }

    #[tokio::test]
    async fn a_local_edit_is_pushed_again_on_the_next_refresh() {
        let live = Live::start().await;
        let reg = client(&live.base, &live.store);
        reg.login(&live.store, "ana", "secretpass1", true)
            .await
            .unwrap();
        // The session lives in the store; a fresh client sees it.
        let reg = client(&live.base, &live.store);
        publish_one(&reg, &live.store, "ana", "shipping").await;

        // The local template moves ahead of the publication.
        let mut t = live
            .store
            .load_templates()
            .unwrap()
            .into_iter()
            .find(|t| t.id == "t1")
            .expect("the published template is local");
        t.name = "Shipping, v2".into();
        live.store.save_template(&t).unwrap();

        reg.refresh(&live.store)
            .await
            .expect("the reconcile succeeds");
        let pub_ = live
            .store
            .publication_for_local("t1")
            .unwrap()
            .expect("the publication is still there");
        assert_eq!(pub_.name, "Shipping, v2");
        let row = live
            .store
            .community_template("ana", "shipping")
            .unwrap()
            .expect("the mirror caught up");
        assert_eq!(row.name, "Shipping, v2");
    }

    #[test]
    fn a_slug_is_lowercased_with_dashed_gaps() {
        assert_eq!(slugify("My Label 01"), "my-label-01");
        assert_eq!(slugify("  --Spaced   Out--  "), "spaced-out");
        assert_eq!(slugify("a"), "a");
        assert_eq!(slugify("???"), "");
    }
}
