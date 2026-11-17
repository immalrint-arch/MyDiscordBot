-- Milestone 8: quotes, role management, channel management, welcome/goodbye.

-- ---------- Quotes ----------
CREATE TABLE quote_config (
    guild_id      TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled       INTEGER NOT NULL DEFAULT 1,   -- master switch for quotes
    reply_trigger INTEGER NOT NULL DEFAULT 1    -- "reply + ping the bot" makes a quote
);

-- ---------- Role management ----------
CREATE TABLE role_panels (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    mode             TEXT NOT NULL CHECK (mode IN ('button', 'dropdown', 'reaction')),
    title            TEXT NOT NULL DEFAULT 'Pick your roles',
    description      TEXT,
    color            INTEGER NOT NULL DEFAULT 5793266,
    max_roles        INTEGER NOT NULL DEFAULT 0 CHECK (max_roles BETWEEN 0 AND 25),  -- 0 = no limit, 1 = pick only one
    required_role_id TEXT,                         -- must have this role to use the panel
    allow_remove     INTEGER NOT NULL DEFAULT 1,   -- can people take the role off again?
    channel_id       TEXT,
    message_id       TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (guild_id, name)
);
CREATE INDEX idx_role_panels_message ON role_panels (message_id);

CREATE TABLE role_panel_options (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id    INTEGER NOT NULL REFERENCES role_panels(id) ON DELETE CASCADE,
    role_id     TEXT NOT NULL,
    label       TEXT NOT NULL,
    emoji       TEXT,
    description TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (panel_id, role_id)
);

CREATE TABLE auto_roles (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    role_id  TEXT NOT NULL,
    target   TEXT NOT NULL DEFAULT 'humans' CHECK (target IN ('humans', 'bots', 'all')),
    timing   TEXT NOT NULL DEFAULT 'join' CHECK (timing IN ('join', 'verified')),
    PRIMARY KEY (guild_id, role_id)
);

CREATE TABLE temp_roles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    role_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL,        -- milliseconds since 1970
    added_by   TEXT NOT NULL,
    reason     TEXT,
    UNIQUE (guild_id, user_id, role_id)
);
CREATE INDEX idx_temp_roles_expires ON temp_roles (expires_at);

-- ---------- Channel management ----------
CREATE TABLE channel_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    spec       TEXT NOT NULL,            -- JSON: the category and its channels
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (guild_id, name)
);

CREATE TABLE tempvoice_config (
    guild_id           TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled            INTEGER NOT NULL DEFAULT 0,
    trigger_channel_id TEXT,              -- joining this voice channel creates a room
    category_id        TEXT,              -- where rooms are created (empty = same as the trigger)
    name_template      TEXT NOT NULL DEFAULT '{displayname}''s room',
    default_limit      INTEGER NOT NULL DEFAULT 0 CHECK (default_limit BETWEEN 0 AND 99)
);

CREATE TABLE tempvoice_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    owner_id   TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_tempvoice_guild ON tempvoice_channels (guild_id);

-- ---------- Welcome and goodbye ----------
CREATE TABLE welcome_config (
    guild_id             TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,

    welcome_enabled      INTEGER NOT NULL DEFAULT 0,
    welcome_channel_id   TEXT,
    welcome_style        TEXT NOT NULL DEFAULT 'embed' CHECK (welcome_style IN ('embed', 'text', 'card')),
    welcome_title        TEXT NOT NULL DEFAULT 'Welcome to {server}!',
    welcome_message      TEXT NOT NULL DEFAULT 'Hey {user}, welcome to **{server}**! You are member **{ordinal}**.',
    welcome_color        INTEGER NOT NULL DEFAULT 3066993,
    welcome_footer       TEXT,
    welcome_banner_url   TEXT,
    welcome_ping         INTEGER NOT NULL DEFAULT 1,
    welcome_delete_after INTEGER NOT NULL DEFAULT 0 CHECK (welcome_delete_after BETWEEN 0 AND 86400),
    welcome_timing       TEXT NOT NULL DEFAULT 'join' CHECK (welcome_timing IN ('join', 'verified')),
    welcome_bots         INTEGER NOT NULL DEFAULT 0,

    dm_enabled           INTEGER NOT NULL DEFAULT 0,
    dm_message           TEXT NOT NULL DEFAULT 'Welcome to **{server}**, {username}! Have a look at the rules and say hi.',

    goodbye_enabled      INTEGER NOT NULL DEFAULT 0,
    goodbye_channel_id   TEXT,
    goodbye_style        TEXT NOT NULL DEFAULT 'embed' CHECK (goodbye_style IN ('embed', 'text', 'card')),
    goodbye_title        TEXT NOT NULL DEFAULT '{username} left',
    goodbye_message      TEXT NOT NULL DEFAULT '**{username}** has left **{server}**. We are now **{count}** members.',
    goodbye_color        INTEGER NOT NULL DEFAULT 15548997,
    goodbye_footer       TEXT,
    goodbye_banner_url   TEXT,
    goodbye_delete_after INTEGER NOT NULL DEFAULT 0 CHECK (goodbye_delete_after BETWEEN 0 AND 86400),
    goodbye_bots         INTEGER NOT NULL DEFAULT 0
);
