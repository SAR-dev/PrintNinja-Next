-- 0001_initial.sql
-- The registry database, as the server shipped it in phase 9. Every
-- statement is idempotent (IF NOT EXISTS) and plain portable SQLite, so
-- the same file runs on a local file, in memory, and on Turso.
--
-- Migrations are applied in file-name order by `pn-server migrate apply`
-- (and by `pn-server serve`, which applies whatever is pending); each
-- file is recorded in schema_migrations the first time it runs, so a
-- file never runs twice.

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    handle        TEXT NOT NULL,
    handle_key    TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS templates (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug       TEXT NOT NULL,
    name       TEXT NOT NULL,
    readme     TEXT NOT NULL,
    track      TEXT NOT NULL,
    template   TEXT NOT NULL,
    sample     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (owner_id, slug)
);
CREATE INDEX IF NOT EXISTS templates_track ON templates (track);
CREATE INDEX IF NOT EXISTS templates_owner ON templates (owner_id);
CREATE TABLE IF NOT EXISTS saved_templates (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    saved_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, template_id)
);
CREATE INDEX IF NOT EXISTS saved_templates_template ON saved_templates (template_id);
-- The change feed: one row per publish, update or unpublish, in the
-- order it happened. seq is the rowid — strictly increasing, never
-- reused, plain portable SQLite. A tombstone is a row with deleted = 1
-- and empty documents. The feed is not pruned: keeping every row is
-- what makes the seq cursor exact for every client at any lag, and the
-- registry is small enough for v1.
CREATE TABLE IF NOT EXISTS template_changes (
    seq        INTEGER PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    slug       TEXT NOT NULL,
    name       TEXT NOT NULL,
    readme     TEXT NOT NULL,
    track      TEXT NOT NULL,
    template   TEXT NOT NULL,
    sample     TEXT NOT NULL,
    deleted    INTEGER NOT NULL,
    changed_at INTEGER NOT NULL
);
