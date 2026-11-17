-- Which channel receives which kind of log. A server can use one channel for
-- everything, or a separate channel per category.
CREATE TABLE log_channels (
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    category   TEXT NOT NULL CHECK (category IN
                 ('messages', 'members', 'roles', 'channels', 'voice', 'server', 'moderation')),
    channel_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, category)
);

-- Channels, roles or users that should never appear in the logs.
CREATE TABLE log_ignores (
    guild_id  TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('channel', 'role', 'user')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, kind, target_id)
);
