-- Milestone 17: translation (Google Translate) settings, auto-translate channels and daily usage.
CREATE TABLE translate_config (
    guild_id      TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    flags_enabled INTEGER NOT NULL DEFAULT 1,       -- react with a flag emoji to translate a message
    daily_limit   INTEGER NOT NULL DEFAULT 50000    -- characters per day for the whole server
);
CREATE TABLE translate_auto (
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    target     TEXT NOT NULL,                       -- language code, e.g. "en"
    PRIMARY KEY (guild_id, channel_id)
);
CREATE TABLE translate_usage (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    day      TEXT NOT NULL,                         -- YYYY-MM-DD (UTC)
    chars    INTEGER NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, day)
);
