//! The publishing server (plan phase 9): the community registry.
//!
//! Accounts, publishing, the community gallery, save-as-local-copy and
//! offline-first sync of a user's templates. A template is validated with
//! [`pn_scene`] — the same parser and structural checks the app runs — so
//! a published template is exactly what the app can print. The server
//! never renders or prints; it stores, validates and serves template
//! documents.
//!
//! The HTTP stack mirrors the app's local print API: axum on tokio, with
//! a rusqlite registry database behind [`Store`].

pub mod auth;
pub mod config;
pub mod router;
pub mod store;

use std::sync::Arc;

use crate::store::Store;

/// What the request handlers can reach. Held apart from the socket so the
/// endpoints can be tested without binding a port.
#[derive(Clone)]
pub struct ServerState {
    pub store: Arc<Store>,
}
