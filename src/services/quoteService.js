const { isSnowflake } = require('../utils/snowflake');

// Remembers, per server, whether quotes are on, and stops people spamming the bot.
function createQuoteService(db, { now = Date.now, cooldownMs = 6000 } = {}) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const insertConfig = db.prepare('INSERT OR IGNORE INTO quote_config (guild_id) VALUES (?)');
    const select = db.prepare('SELECT * FROM quote_config WHERE guild_id = ?');
    const lastUse = new Map(); // "guild:user" -> time of last quote

    function ensure(guildId) {
        if (!isSnowflake(guildId)) throw new TypeError('Invalid guild ID.');
        insertGuild.run(guildId);
        insertConfig.run(guildId);
    }
    function set(guildId, column, value) {
        ensure(guildId);
        db.prepare(`UPDATE quote_config SET ${column} = ? WHERE guild_id = ?`).run(value ? 1 : 0, guildId);
    }

    return {
        getConfig(guildId) {
            ensure(guildId);
            const row = select.get(guildId);
            return { enabled: row.enabled === 1, replyTrigger: row.reply_trigger === 1 };
        },
        setEnabled: (guildId, value) => set(guildId, 'enabled', value),
        setReplyTrigger: (guildId, value) => set(guildId, 'reply_trigger', value),

        // Returns 0 if the person may make a quote now (and starts their cooldown),
        // otherwise the number of milliseconds they still have to wait.
        checkCooldown(guildId, userId) {
            const key = `${guildId}:${userId}`;
            const current = now();
            for (const [k, t] of lastUse) if (current - t > cooldownMs) lastUse.delete(k); // tidy up
            const last = lastUse.get(key);
            if (last !== undefined && current - last < cooldownMs) return cooldownMs - (current - last);
            lastUse.set(key, current);
            return 0;
        },
    };
}

module.exports = { createQuoteService };
