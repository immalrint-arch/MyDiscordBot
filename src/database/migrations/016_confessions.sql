-- Milestone 13: anonymous confessions (one channel per server).
CREATE TABLE confession_config (
    guild_id         TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id       TEXT,                       -- NULL = confessions are off
    cooldown_seconds INTEGER NOT NULL DEFAULT 60
);

-- The author is stored ONLY so staff can block an abuser by confession number.
-- No command ever shows it, and it is never put in a message.
CREATE TABLE confessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    number     INTEGER NOT NULL,
    author_id  TEXT NOT NULL,
    content    TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    deleted    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (guild_id, number)
);
CREATE INDEX idx_confessions_author ON confessions (guild_id, author_id, created_at);

CREATE TABLE confession_blocks (
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    from_number INTEGER NOT NULL,                -- the confession that led to the block (shown instead of the person)
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (guild_id, user_id)
);
