-- Milestone 9: optional anti-nuke alert role + leveling system.

ALTER TABLE antinuke_config ADD COLUMN alert_role_id TEXT;

-- ---------- Leveling ----------
CREATE TABLE level_config (
    guild_id            TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled             INTEGER NOT NULL DEFAULT 0,
    xp_min              INTEGER NOT NULL DEFAULT 15 CHECK (xp_min BETWEEN 1 AND 500),
    xp_max              INTEGER NOT NULL DEFAULT 25 CHECK (xp_max BETWEEN 1 AND 500),
    cooldown_seconds    INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_seconds BETWEEN 0 AND 3600),
    min_length          INTEGER NOT NULL DEFAULT 3 CHECK (min_length BETWEEN 0 AND 100),
    voice_xp            INTEGER NOT NULL DEFAULT 0 CHECK (voice_xp BETWEEN 0 AND 100),   -- XP per minute in voice, 0 = off
    multiplier_percent  INTEGER NOT NULL DEFAULT 100 CHECK (multiplier_percent BETWEEN 10 AND 1000),
    announce_mode       TEXT NOT NULL DEFAULT 'channel' CHECK (announce_mode IN ('channel', 'current', 'dm', 'off')),
    announce_channel_id TEXT,
    announce_style      TEXT NOT NULL DEFAULT 'card' CHECK (announce_style IN ('card', 'embed', 'text')),
    levelup_message     TEXT NOT NULL DEFAULT '{user} just reached level **{level}**!',
    levelup_ping        INTEGER NOT NULL DEFAULT 1,
    reward_mode         TEXT NOT NULL DEFAULT 'stack' CHECK (reward_mode IN ('stack', 'replace')),
    highlights_channel_id TEXT,
    highlights_period   TEXT NOT NULL DEFAULT 'off' CHECK (highlights_period IN ('off', 'daily', 'weekly', 'monthly')),
    highlights_last     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE level_users (
    guild_id     TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    xp           INTEGER NOT NULL DEFAULT 0,
    level        INTEGER NOT NULL DEFAULT 0,
    messages     INTEGER NOT NULL DEFAULT 0,
    last_xp_at   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_level_users_rank ON level_users (guild_id, xp DESC);

-- One row per (server, person, day) so daily/weekly/monthly boards can be added up.
CREATE TABLE level_daily (
    guild_id  TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL,
    day       INTEGER NOT NULL,        -- days since 1970 (UTC)
    xp        INTEGER NOT NULL DEFAULT 0,
    levels    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, day)
);
CREATE INDEX idx_level_daily_day ON level_daily (guild_id, day);

CREATE TABLE level_roles (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    level    INTEGER NOT NULL CHECK (level BETWEEN 1 AND 500),
    role_id  TEXT NOT NULL,
    PRIMARY KEY (guild_id, level)
);

-- Places and roles that earn no XP.
CREATE TABLE level_ignores (
    guild_id  TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('channel', 'role')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, kind, target_id)
);

-- Roles that get more XP (for example boosters).
CREATE TABLE level_boosts (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    role_id  TEXT NOT NULL,
    percent  INTEGER NOT NULL CHECK (percent BETWEEN 10 AND 500),
    PRIMARY KEY (guild_id, role_id)
);
