//! Printer profiles: data, not code (plan §5.4 / §5.10, built in phase 2).
//!
//! One TOML file per model, shipped with the app and extendable by the
//! user. Carries the profile status: `verified` | `untested` | `community`.
//! No per-printer code paths exist in core — behavior differences live in
//! profile data.
