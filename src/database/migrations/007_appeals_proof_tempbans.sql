-- A screenshot/image link a moderator attached as proof, shown on the case card.
ALTER TABLE cases ADD COLUMN proof_url TEXT;

-- Where ban appeals are posted (falls back to the moderation log channel when empty).
ALTER TABLE guild_settings ADD COLUMN appeal_channel_id TEXT;

-- A banned person's appeal, reviewed by moderators with buttons.
CREATE TABLE ban_appeals (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id          TEXT NOT NULL,
    ban_case_number  INTEGER,
    message          TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','blacklisted','dismissed')),
    resolved_by      TEXT,
    resolved_at      TEXT,
    channel_id       TEXT,
    message_id       TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_appeals_user ON ban_appeals (guild_id, user_id, status);

-- People who may not appeal again ("Deny + Blacklist").
CREATE TABLE appeal_blacklist (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

-- Bans that end by themselves ("/ban add duration:7d").
CREATE TABLE temp_bans (
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    case_number INTEGER,
    expires_at  TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_temp_bans_due ON temp_bans (expires_at);
