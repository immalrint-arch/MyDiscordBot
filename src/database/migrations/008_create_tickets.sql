-- Ticket settings for each server. Tickets are OFF until a staff member enables them.
CREATE TABLE ticket_config (
    guild_id          TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled           INTEGER NOT NULL DEFAULT 0,
    category_id       TEXT,                       -- new ticket channels are created inside this category
    log_channel_id    TEXT,                       -- transcripts and ticket logs go here
    max_open_per_user INTEGER NOT NULL DEFAULT 1 CHECK (max_open_per_user BETWEEN 1 AND 10),
    ratings_enabled   INTEGER NOT NULL DEFAULT 1
);

-- Roles that can see and answer tickets.
CREATE TABLE ticket_staff_roles (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    role_id  TEXT NOT NULL,
    PRIMARY KEY (guild_id, role_id)
);

CREATE TABLE tickets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    ticket_number INTEGER NOT NULL,
    channel_id    TEXT NOT NULL,
    opener_id     TEXT NOT NULL,
    subject       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    claimed_by    TEXT,
    closed_by     TEXT,                           -- empty when the channel was deleted by hand
    close_reason  TEXT,
    rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    closed_at     TEXT,
    UNIQUE (guild_id, ticket_number)
);
CREATE INDEX idx_tickets_channel ON tickets (channel_id);
CREATE INDEX idx_tickets_opener ON tickets (guild_id, opener_id, status);
