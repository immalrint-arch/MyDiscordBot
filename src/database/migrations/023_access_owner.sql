-- Milestone 21: per-command rules, global user blacklist, bot-wide settings.
CREATE TABLE command_rules (
    guild_id  TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    command   TEXT NOT NULL,
    kind      TEXT NOT NULL CHECK (kind IN ('role_allow', 'role_deny', 'channel_allow', 'channel_deny', 'disabled')),
    target_id TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (guild_id, command, kind, target_id)
);
CREATE TABLE global_blacklist (
    user_id  TEXT PRIMARY KEY,
    reason   TEXT,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL
);
CREATE TABLE bot_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
