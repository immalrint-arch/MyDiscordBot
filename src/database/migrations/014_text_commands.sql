-- Milestone 11: text commands (for example "!ban @user reason") with an editable prefix.

CREATE TABLE text_command_config (
    guild_id        TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled         INTEGER NOT NULL DEFAULT 0,
    prefix          TEXT NOT NULL DEFAULT '!',
    mention_prefix  INTEGER NOT NULL DEFAULT 1   -- "@Incomu ban @user" also works
);

-- Commands switched off for text use in a server (the slash version keeps working).
CREATE TABLE text_command_disabled (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    command  TEXT NOT NULL,
    PRIMARY KEY (guild_id, command)
);

-- Short names, for example  b -> "ban add".
CREATE TABLE text_command_aliases (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    alias    TEXT NOT NULL,
    target   TEXT NOT NULL,
    PRIMARY KEY (guild_id, alias)
);
