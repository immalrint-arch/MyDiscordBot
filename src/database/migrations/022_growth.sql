-- Milestone 20: invite tracker, sticky roles, member counters.
CREATE TABLE invite_config (
    guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE invite_joins (
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    inviter_id TEXT,
    code       TEXT,
    joined_at  INTEGER NOT NULL,
    left_at    INTEGER,
    fake       INTEGER NOT NULL DEFAULT 0,
    joins      INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_invite_joins_inviter ON invite_joins (guild_id, inviter_id);
CREATE TABLE stickyrole_config (
    guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE stickyrole_saved (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL,
    role_ids TEXT NOT NULL,
    saved_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE member_counters (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id  TEXT NOT NULL,
    template    TEXT NOT NULL,
    last_name   TEXT,
    last_update INTEGER NOT NULL DEFAULT 0,
    UNIQUE (guild_id, channel_id)
);
