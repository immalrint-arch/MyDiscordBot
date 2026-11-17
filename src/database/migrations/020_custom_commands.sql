-- Milestone 18: custom commands (tags) and auto-responders.
CREATE TABLE custom_commands (
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    response   TEXT NOT NULL,
    created_by TEXT NOT NULL,
    uses       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, name)
);
CREATE TABLE autoresponders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    trigger_text     TEXT NOT NULL,
    match_type       TEXT NOT NULL CHECK (match_type IN ('contains', 'exact', 'starts', 'word')),
    response         TEXT NOT NULL,
    cooldown_seconds INTEGER NOT NULL DEFAULT 30,
    channel_id       TEXT,                           -- NULL = every channel
    enabled          INTEGER NOT NULL DEFAULT 1,
    uses             INTEGER NOT NULL DEFAULT 0,
    created_by       TEXT NOT NULL,
    created_at       INTEGER NOT NULL
);
CREATE INDEX idx_autoresponders_guild ON autoresponders (guild_id, id);
