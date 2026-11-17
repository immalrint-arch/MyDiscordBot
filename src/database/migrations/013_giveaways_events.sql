-- Milestone 10: giveaways and events.

CREATE TABLE giveaways (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id       TEXT NOT NULL,
    message_id       TEXT,
    host_id          TEXT NOT NULL,
    prize            TEXT NOT NULL,
    description      TEXT,
    winners          INTEGER NOT NULL DEFAULT 1 CHECK (winners BETWEEN 1 AND 20),
    ends_at          INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
    required_role_id TEXT,
    bypass_role_id   TEXT,
    min_level        INTEGER NOT NULL DEFAULT 0,
    min_days         INTEGER NOT NULL DEFAULT 0,
    ping_role_id     TEXT,
    winner_ids       TEXT NOT NULL DEFAULT '[]',
    created_at       INTEGER NOT NULL,
    ended_at         INTEGER
);
CREATE INDEX idx_giveaways_due ON giveaways (status, ends_at);
CREATE INDEX idx_giveaways_guild ON giveaways (guild_id, status);

CREATE TABLE giveaway_entries (
    giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id   TEXT NOT NULL,
    message_id   TEXT,
    host_id      TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    location     TEXT,
    starts_at    INTEGER NOT NULL,
    ping_role_id TEXT,
    status       TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'started', 'cancelled')),
    reminded     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
);
CREATE INDEX idx_events_due ON events (status, starts_at);

CREATE TABLE event_rsvps (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL,
    answer   TEXT NOT NULL CHECK (answer IN ('going', 'maybe')),
    PRIMARY KEY (event_id, user_id)
);
