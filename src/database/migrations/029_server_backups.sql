-- Milestone 27: server backups (roles, channels, permissions) and restore.
CREATE TABLE server_backups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    auto       INTEGER NOT NULL DEFAULT 0,
    roles      INTEGER NOT NULL DEFAULT 0,
    channels   INTEGER NOT NULL DEFAULT 0,
    size       INTEGER NOT NULL DEFAULT 0,
    data       TEXT NOT NULL
);
CREATE INDEX idx_server_backups_guild ON server_backups (guild_id, id);
CREATE TABLE backup_config (
    guild_id     TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    auto_days    INTEGER NOT NULL DEFAULT 0,   -- 0 = no automatic backups
    last_auto_at INTEGER
);
