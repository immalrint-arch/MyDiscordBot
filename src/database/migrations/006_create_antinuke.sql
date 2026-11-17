-- Lockdown remembers which channels IT locked, so /unlockdown never touches
-- channels that a moderator locked on purpose with /lock.
ALTER TABLE channel_locks ADD COLUMN source TEXT NOT NULL DEFAULT 'lock';

-- Anti-nuke settings, one row per server. Off by default (safe defaults).
CREATE TABLE antinuke_config (
    guild_id         TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled          INTEGER NOT NULL DEFAULT 0,
    mode             TEXT NOT NULL DEFAULT 'alert' CHECK (mode IN ('alert', 'contain')),
    sensitivity      TEXT NOT NULL DEFAULT 'balanced' CHECK (sensitivity IN ('relaxed', 'balanced', 'strict')),
    alert_channel_id TEXT,
    safe_mode_until  TEXT,
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Custom limits ("3 channel deletions in 10 seconds"), per rule.
CREATE TABLE antinuke_thresholds (
    guild_id       TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    rule           TEXT NOT NULL,
    threshold      INTEGER NOT NULL CHECK (threshold BETWEEN 1 AND 100),
    window_seconds INTEGER NOT NULL CHECK (window_seconds BETWEEN 5 AND 300),
    PRIMARY KEY (guild_id, rule)
);

-- Users and roles the owner has chosen to trust (for example a ticket bot).
CREATE TABLE antinuke_trusted (
    guild_id  TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('user', 'role')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, kind, target_id)
);

-- A record of every suspicious situation (an "incident").
CREATE TABLE antinuke_incidents (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    incident_number  INTEGER NOT NULL,
    actor_id         TEXT,            -- NULL when the audit log could not tell us who did it
    actor_class      TEXT NOT NULL,
    severity         TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'contained', 'safe', 'restored')),
    rules            TEXT NOT NULL DEFAULT '[]',   -- JSON list of triggered rules
    evidence         TEXT NOT NULL DEFAULT '[]',   -- JSON list of what happened
    removed_roles    TEXT NOT NULL DEFAULT '[]',   -- JSON list of role IDs taken away by containment
    simulated        INTEGER NOT NULL DEFAULT 0,
    alert_channel_id TEXT,
    alert_message_id TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (guild_id, incident_number)
);
CREATE INDEX idx_incidents_actor ON antinuke_incidents (guild_id, actor_id, created_at);

-- The STRUCTURE (name, type, permissions...) of deleted channels and roles, so they can be
-- recreated. Message history cannot be recovered. Old rows are purged after 14 days.
CREATE TABLE antinuke_deleted_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('channel', 'role')),
    original_id TEXT NOT NULL,
    actor_id    TEXT,
    data        TEXT NOT NULL,
    recovered   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_deleted_items ON antinuke_deleted_items (guild_id, actor_id, created_at);
