-- Ticket display options (what the bot says when a ticket opens).
ALTER TABLE ticket_config ADD COLUMN welcome_message TEXT;
ALTER TABLE ticket_config ADD COLUMN staff_message TEXT;
ALTER TABLE ticket_config ADD COLUMN ask_form INTEGER NOT NULL DEFAULT 0;   -- 1 = ask for a subject before opening

-- Verification (captcha) settings. Off until a moderator enables it.
CREATE TABLE verification_config (
    guild_id           TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    enabled            INTEGER NOT NULL DEFAULT 0,
    verified_role_id   TEXT,          -- given after passing the captcha
    unverified_role_id TEXT,          -- optional: given on join, removed after passing
    max_attempts       INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10)
);
