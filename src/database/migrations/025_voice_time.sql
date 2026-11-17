-- Milestone 23: time spent in voice channels (separate from voice XP).
CREATE TABLE voice_time_config (
    guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE voice_time_totals (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL,
    minutes  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_voice_totals_rank ON voice_time_totals (guild_id, minutes DESC);
CREATE TABLE voice_time_daily (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL,
    day      INTEGER NOT NULL,
    minutes  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, day)
);
