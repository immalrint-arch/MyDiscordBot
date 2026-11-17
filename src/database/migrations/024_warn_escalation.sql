-- Milestone 22: automatic action when a member reaches a number of warnings.
CREATE TABLE warn_escalation_config (
    guild_id    TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled     INTEGER NOT NULL DEFAULT 0,
    window_days INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE warn_escalation_rules (
    guild_id         TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    threshold        INTEGER NOT NULL,
    action           TEXT NOT NULL CHECK (action IN ('timeout', 'kick', 'ban')),
    duration_minutes INTEGER,
    PRIMARY KEY (guild_id, threshold)
);
