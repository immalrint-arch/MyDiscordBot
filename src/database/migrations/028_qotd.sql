-- Milestone 26: question of the day.
CREATE TABLE qotd_config (
    guild_id    TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled     INTEGER NOT NULL DEFAULT 0,
    channel_id  TEXT,
    role_id     TEXT,
    hour        INTEGER NOT NULL DEFAULT 9,
    minute      INTEGER NOT NULL DEFAULT 0,
    utc_offset  INTEGER NOT NULL DEFAULT 0,       -- whole hours, -12 to 14
    use_threads INTEGER NOT NULL DEFAULT 1,
    use_builtin INTEGER NOT NULL DEFAULT 1,       -- also use the questions that come with the bot
    last_day    INTEGER,                          -- local day number of the last scheduled post
    counter     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE qotd_questions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    added_by     TEXT NOT NULL,
    added_at     INTEGER NOT NULL,
    used_count   INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER
);
CREATE INDEX idx_qotd_questions_guild ON qotd_questions (guild_id, used_count, id);
-- which built-in questions this server has already seen in the current round
CREATE TABLE qotd_builtin_used (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    idx      INTEGER NOT NULL,
    PRIMARY KEY (guild_id, idx)
);
