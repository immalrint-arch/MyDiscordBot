-- Milestone 14: polls, reminders, suggestions, starboard.
CREATE TABLE polls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    poll_number INTEGER NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT,
    creator_id  TEXT NOT NULL,
    question    TEXT NOT NULL,
    options     TEXT NOT NULL,                 -- JSON list of option texts
    multiple    INTEGER NOT NULL DEFAULT 0,    -- 1 = people may pick several options
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ended')),
    ends_at     INTEGER,                       -- ms since 1970, NULL = until someone ends it
    created_at  INTEGER NOT NULL,
    UNIQUE (guild_id, poll_number)
);
CREATE INDEX idx_polls_due ON polls (status, ends_at);
CREATE TABLE poll_votes (
    poll_id      INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    PRIMARY KEY (poll_id, user_id, option_index)
);

CREATE TABLE reminders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    text       TEXT NOT NULL,
    due_at     INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_reminders_due ON reminders (status, due_at);
CREATE INDEX idx_reminders_user ON reminders (guild_id, user_id, status);

CREATE TABLE suggestion_config (
    guild_id   TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id TEXT
);
CREATE TABLE suggestions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    number      INTEGER NOT NULL,
    author_id   TEXT NOT NULL,
    content     TEXT NOT NULL,
    channel_id  TEXT,
    message_id  TEXT,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'considered', 'approved', 'denied')),
    handled_by  TEXT,
    note        TEXT,
    created_at  INTEGER NOT NULL,
    UNIQUE (guild_id, number)
);
CREATE TABLE suggestion_votes (
    suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    vote          INTEGER NOT NULL CHECK (vote IN (1, -1)),
    PRIMARY KEY (suggestion_id, user_id)
);

CREATE TABLE starboard_config (
    guild_id   TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id TEXT,
    threshold  INTEGER NOT NULL DEFAULT 3,
    emoji      TEXT NOT NULL DEFAULT '⭐'
);
CREATE TABLE starboard_posts (
    guild_id          TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    source_message_id TEXT NOT NULL,
    source_channel_id TEXT NOT NULL,
    star_channel_id   TEXT NOT NULL,
    star_message_id   TEXT NOT NULL,
    stars             INTEGER NOT NULL,
    PRIMARY KEY (guild_id, source_message_id)
);
