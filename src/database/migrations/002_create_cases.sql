-- Every moderation action that targets a person becomes a "case".
-- Case numbers count up separately for each server (Case #1, #2, ...).
CREATE TABLE cases (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT    NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    case_number  INTEGER NOT NULL,
    type         TEXT    NOT NULL CHECK (type IN
                   ('warn', 'note', 'kick', 'ban', 'unban', 'softban', 'timeout', 'untimeout')),
    target_id    TEXT    NOT NULL,   -- Discord ID of the person it was done to
    moderator_id TEXT    NOT NULL,   -- Discord ID of the moderator
    reason       TEXT,               -- plain text, at most 512 characters
    duration_ms  INTEGER,            -- used by timeouts
    active       INTEGER NOT NULL DEFAULT 1,   -- warnings can be pardoned (set to 0)
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (guild_id, case_number)
);

-- Indexes make "show me this person's cases" fast even with many cases.
CREATE INDEX idx_cases_target ON cases (guild_id, target_id, case_number);
