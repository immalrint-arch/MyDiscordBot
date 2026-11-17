-- Should the bot try to send a private message to the person it moderates?
-- 1 = yes (default), 0 = no. Each server decides for itself.
ALTER TABLE guild_settings ADD COLUMN dm_on_action INTEGER NOT NULL DEFAULT 1;
