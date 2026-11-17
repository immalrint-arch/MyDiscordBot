-- Milestone 16: fun (games settings, birthdays, AFK, counting, bump reminders, game scores).
CREATE TABLE fun_config (
    guild_id        TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    games_enabled   INTEGER NOT NULL DEFAULT 1,
    games_channel_id TEXT,                          -- NULL = games work in every channel
    afk_enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE birthday_config (
    guild_id   TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id TEXT,
    role_id    TEXT,
    message    TEXT
);
CREATE TABLE birthdays (
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    year       INTEGER,                              -- optional (to show age)
    utc_offset INTEGER NOT NULL DEFAULT 0,           -- whole hours, so "today" is the person's own today
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE birthday_log (                          -- one row per announced birthday: never announced twice
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    date     TEXT NOT NULL,                          -- YYYY-MM-DD (the person's local date)
    PRIMARY KEY (guild_id, user_id, date)
);
CREATE TABLE birthday_roles (                        -- birthday roles to take away again
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    role_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_birthday_roles_due ON birthday_roles (expires_at);

CREATE TABLE afk (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL,
    reason   TEXT NOT NULL,
    since    INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE counting_config (
    guild_id     TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id   TEXT,
    current      INTEGER NOT NULL DEFAULT 0,
    last_user_id TEXT,
    record       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE counting_stats (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    correct  INTEGER NOT NULL DEFAULT 0,
    ruined   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE bump_config (
    guild_id   TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id TEXT,
    role_id    TEXT,
    next_at    INTEGER,
    reminded   INTEGER NOT NULL DEFAULT 1            -- 1 = nothing waiting to be reminded
);

CREATE TABLE game_scores (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    game     TEXT NOT NULL,
    wins     INTEGER NOT NULL DEFAULT 0,
    played   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, game)
);
