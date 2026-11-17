-- Milestone 24: modmail (members DM the bot to talk privately with staff).
CREATE TABLE modmail_config (
    guild_id       TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled        INTEGER NOT NULL DEFAULT 0,
    category_id    TEXT,
    staff_role_id  TEXT,
    log_channel_id TEXT,
    anonymous      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE modmail_threads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    channel_id    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_at     INTEGER NOT NULL,
    closed_at     INTEGER,
    closed_by     TEXT,
    close_reason  TEXT
);
-- a member can have only one open conversation per server (the database enforces it)
CREATE UNIQUE INDEX idx_modmail_one_open ON modmail_threads (guild_id, user_id) WHERE status = 'open';
CREATE INDEX idx_modmail_channel ON modmail_threads (channel_id);
CREATE INDEX idx_modmail_user ON modmail_threads (user_id, status);
CREATE TABLE modmail_blocks (
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    reason     TEXT,
    blocked_by TEXT NOT NULL,
    blocked_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
