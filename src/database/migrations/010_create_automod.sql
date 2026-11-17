-- Auto-moderation gets its own log category, so its logs never mix with manual moderation.
-- (SQLite cannot change a CHECK rule in place, so the table is rebuilt.)
CREATE TABLE log_channels_new (
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    category   TEXT NOT NULL CHECK (category IN
                 ('messages', 'members', 'roles', 'channels', 'voice', 'server', 'moderation', 'automod')),
    channel_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, category)
);
INSERT INTO log_channels_new (guild_id, category, channel_id) SELECT guild_id, category, channel_id FROM log_channels;
DROP TABLE log_channels;
ALTER TABLE log_channels_new RENAME TO log_channels;

-- Global auto-moderation switch and the strike system.
CREATE TABLE automod_config (
    guild_id              TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled               INTEGER NOT NULL DEFAULT 0,
    strike_limit          INTEGER NOT NULL DEFAULT 3  CHECK (strike_limit BETWEEN 1 AND 20),
    strike_window_minutes INTEGER NOT NULL DEFAULT 10 CHECK (strike_window_minutes BETWEEN 1 AND 1440),
    timeout_minutes       INTEGER NOT NULL DEFAULT 10 CHECK (timeout_minutes BETWEEN 1 AND 40320)
);

-- Per-rule overrides. A rule without a row uses the defaults in code.
CREATE TABLE automod_rules (
    guild_id       TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    rule           TEXT NOT NULL,
    enabled        INTEGER,                         -- NULL = default
    action         TEXT CHECK (action IN ('delete', 'timeout', 'kick')),
    limit_value    INTEGER,
    window_seconds INTEGER,
    PRIMARY KEY (guild_id, rule)
);

-- Banned words, allowed link domains and allowed invite codes.
CREATE TABLE automod_lists (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    kind     TEXT NOT NULL CHECK (kind IN ('word', 'domain', 'invite')),
    value    TEXT NOT NULL,
    PRIMARY KEY (guild_id, kind, value)
);

-- Roles, channels and people auto-moderation ignores.
CREATE TABLE automod_exempt (
    guild_id  TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('role', 'channel', 'user')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, kind, target_id)
);

CREATE TABLE automod_strikes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    rule       TEXT NOT NULL,
    created_at INTEGER NOT NULL                     -- milliseconds
);
CREATE INDEX idx_automod_strikes ON automod_strikes (guild_id, user_id, created_at);

-- A record of everything auto-moderation did (for /automod stats). Not the same as moderation cases.
CREATE TABLE automod_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    channel_id TEXT,
    rule       TEXT NOT NULL,
    action     TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_automod_events ON automod_events (guild_id, created_at);
