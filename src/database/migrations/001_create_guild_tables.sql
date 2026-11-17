-- One row per Discord server (a "guild" in Discord's terms) the bot has seen.
-- We store only the server ID and when we first saw it. No personal data.
CREATE TABLE guilds (
    guild_id      TEXT PRIMARY KEY,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Settings for each server. Every server has its own separate row.
-- If a guild row is ever deleted, its settings are deleted too (ON DELETE CASCADE).
CREATE TABLE guild_settings (
    guild_id       TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    log_channel_id TEXT,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
