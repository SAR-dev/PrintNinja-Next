//! Scene format and data model — the single template language for the
//! `scene` track (plan §5.1, built in phase 4).
//!
//! Depends on nothing: the bottom of the dependency stack. JSON document
//! with a typed schema; every other crate may depend on this one, nothing
//! here may depend outward.
