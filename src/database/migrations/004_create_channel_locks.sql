-- When /lock closes a channel, we remember what @everyone's "Send Messages"
-- permission was BEFORE, so /unlock can put it back exactly as it was.
CREATE TABLE channel_locks (
    guild_id       TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id     TEXT NOT NULL,
    previous_state TEXT NOT NULL CHECK (previous_state IN ('allow', 'deny', 'neutral')),
    locked_by      TEXT NOT NULL,
    locked_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (guild_id, channel_id)
);
