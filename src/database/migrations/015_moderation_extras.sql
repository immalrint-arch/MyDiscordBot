-- Milestone 12: quarantine, reports and the new case types.

-- 1) Cases get two new types (quarantine, unquarantine). SQLite cannot change a CHECK rule in place,
--    so the table is rebuilt: new table, copy every row, swap. Case numbers and IDs are kept exactly.
CREATE TABLE cases_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT    NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    case_number  INTEGER NOT NULL,
    type         TEXT    NOT NULL CHECK (type IN
                   ('warn', 'note', 'kick', 'ban', 'unban', 'softban', 'timeout', 'untimeout', 'quarantine', 'unquarantine')),
    target_id    TEXT    NOT NULL,
    moderator_id TEXT    NOT NULL,
    reason       TEXT,
    duration_ms  INTEGER,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    proof_url    TEXT,
    UNIQUE (guild_id, case_number)
);
INSERT INTO cases_new (id, guild_id, case_number, type, target_id, moderator_id, reason, duration_ms, active, created_at, proof_url)
    SELECT id, guild_id, case_number, type, target_id, moderator_id, reason, duration_ms, active, created_at, proof_url FROM cases;
DROP TABLE cases;
ALTER TABLE cases_new RENAME TO cases;
CREATE INDEX idx_cases_target ON cases (guild_id, target_id, case_number);
CREATE INDEX idx_cases_moderator ON cases (guild_id, moderator_id, created_at);

-- 2) Quarantine settings: the role people are given, and the one channel they can still see.
CREATE TABLE quarantine_config (
    guild_id   TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    role_id    TEXT,
    channel_id TEXT
);

-- Who is quarantined right now, and the roles to give back afterwards (JSON list of role IDs).
CREATE TABLE quarantined_members (
    guild_id     TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    role_ids     TEXT NOT NULL DEFAULT '[]',
    moderator_id TEXT NOT NULL,
    reason       TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (guild_id, user_id)
);

-- 3) Member reports to staff.
CREATE TABLE report_config (
    guild_id   TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id TEXT,
    ping_role_id TEXT
);
CREATE TABLE reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    report_number INTEGER NOT NULL,
    reporter_id TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    handled_by  TEXT,
    handled_at  TEXT,
    channel_id  TEXT,
    message_id  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (guild_id, report_number)
);
CREATE INDEX idx_reports_reporter ON reports (guild_id, reporter_id, created_at);
