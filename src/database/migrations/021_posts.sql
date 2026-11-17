-- Milestone 19: scheduled posts and sticky messages.
CREATE TABLE scheduled_posts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id       TEXT NOT NULL,
    content          TEXT,
    embed_json       TEXT,
    ping_role_id     TEXT,
    interval_seconds INTEGER,
    max_runs         INTEGER,
    runs             INTEGER NOT NULL DEFAULT 0,
    next_run_at      INTEGER NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 1,
    fail_count       INTEGER NOT NULL DEFAULT 0,
    created_by       TEXT NOT NULL,
    created_at       INTEGER NOT NULL
);
CREATE INDEX idx_scheduled_due ON scheduled_posts (enabled, next_run_at);
CREATE INDEX idx_scheduled_guild ON scheduled_posts (guild_id);
CREATE TABLE sticky_messages (
    guild_id        TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id      TEXT NOT NULL,
    content         TEXT,
    embed_json      TEXT,
    last_message_id TEXT,
    created_by      TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
);
