-- Milestone 25: raid mode (automatic join-surge protection).
CREATE TABLE raid_config (
    guild_id           TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled            INTEGER NOT NULL DEFAULT 0,
    joins              INTEGER NOT NULL DEFAULT 10,   -- this many joins ...
    seconds            INTEGER NOT NULL DEFAULT 30,   -- ... within this many seconds starts raid mode
    action             TEXT NOT NULL DEFAULT 'alert' CHECK (action IN ('alert', 'timeout', 'kick')),
    duration_minutes   INTEGER NOT NULL DEFAULT 15,   -- raid mode ends this long after the last raider joined
    alert_channel_id   TEXT,
    alert_role_id      TEXT,
    raise_verification INTEGER NOT NULL DEFAULT 1,
    pause_invites      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE raid_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id          TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    started_at        INTEGER NOT NULL,
    last_join_at      INTEGER NOT NULL,
    ended_at          INTEGER,
    ended_by          TEXT,
    auto              INTEGER NOT NULL DEFAULT 1,
    raiders           INTEGER NOT NULL DEFAULT 0,
    prev_verification INTEGER,   -- verification level before we raised it (NULL = we did not change it)
    set_verification  INTEGER,
    invites_paused    INTEGER NOT NULL DEFAULT 0,   -- 1 = we paused invites and must resume them
    alert_message_id  TEXT,
    alert_channel_id  TEXT
);
-- only one active raid per server (the database enforces it)
CREATE UNIQUE INDEX idx_raid_one_active ON raid_events (guild_id) WHERE ended_at IS NULL;
