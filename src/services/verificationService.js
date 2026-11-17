const { isSnowflake } = require('../utils/snowflake');

function createVerificationService(db) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const insertConfig = db.prepare('INSERT OR IGNORE INTO verification_config (guild_id) VALUES (?)');
    const select = db.prepare('SELECT * FROM verification_config WHERE guild_id = ?');

    function ensure(guildId) {
        if (!isSnowflake(guildId)) throw new TypeError('Invalid guild ID.');
        insertGuild.run(guildId);
        insertConfig.run(guildId);
    }
    // `column` is always a fixed name from this file, never user text.
    function set(guildId, column, value) {
        ensure(guildId);
        db.prepare(`UPDATE verification_config SET ${column} = ? WHERE guild_id = ?`).run(value, guildId);
    }
    const checkId = (id) => { if (id !== null && !isSnowflake(id)) throw new TypeError('Invalid role.'); };

    return {
        getConfig(guildId) {
            ensure(guildId);
            const r = select.get(guildId);
            return { guildId, enabled: r.enabled === 1, verifiedRoleId: r.verified_role_id, unverifiedRoleId: r.unverified_role_id, maxAttempts: r.max_attempts };
        },
        setEnabled: (g, v) => set(g, 'enabled', v ? 1 : 0),
        setVerifiedRole: (g, id) => { checkId(id); set(g, 'verified_role_id', id); },
        setUnverifiedRole: (g, id) => { checkId(id); set(g, 'unverified_role_id', id); },
        setMaxAttempts: (g, n) => { if (!Number.isInteger(n) || n < 1 || n > 10) throw new TypeError('Attempts must be 1-10.'); set(g, 'max_attempts', n); },
    };
}

module.exports = { createVerificationService };
