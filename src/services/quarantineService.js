const { isSnowflake } = require('../utils/snowflake');

class QuarantineServiceError extends Error {} // safe to show to a moderator
const MAX_ROLES_SAVED = 250;

function createQuarantineService(db) {
    const assertId = (id, what = 'ID') => { if (!isSnowflake(id)) throw new TypeError(`Invalid ${what}.`); };
    const ensure = (guildId) => {
        assertId(guildId, 'guild ID');
        db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
        db.prepare('INSERT OR IGNORE INTO quarantine_config (guild_id) VALUES (?)').run(guildId);
    };
    const toMember = (r) => (r ? { guildId: r.guild_id, userId: r.user_id, roleIds: JSON.parse(r.role_ids), moderatorId: r.moderator_id, reason: r.reason, createdAt: r.created_at } : null);

    return {
        getConfig(guildId) {
            ensure(guildId);
            const r = db.prepare('SELECT role_id, channel_id FROM quarantine_config WHERE guild_id = ?').get(guildId);
            return { roleId: r.role_id, channelId: r.channel_id };
        },
        setConfig(guildId, { roleId, channelId }) {
            ensure(guildId);
            if (roleId !== undefined) { if (roleId !== null) assertId(roleId, 'role ID'); db.prepare('UPDATE quarantine_config SET role_id = ? WHERE guild_id = ?').run(roleId, guildId); }
            if (channelId !== undefined) { if (channelId !== null) assertId(channelId, 'channel ID'); db.prepare('UPDATE quarantine_config SET channel_id = ? WHERE guild_id = ?').run(channelId, guildId); }
        },
        // Saves the roles to give back. Returns false if that person was already quarantined (nothing is overwritten).
        add(guildId, userId, { roleIds, moderatorId, reason = null }) {
            ensure(guildId); assertId(userId, 'user ID'); assertId(moderatorId, 'moderator ID');
            if (!Array.isArray(roleIds) || roleIds.length > MAX_ROLES_SAVED || !roleIds.every(isSnowflake)) throw new TypeError('Invalid role list.');
            return Number(db.prepare('INSERT OR IGNORE INTO quarantined_members (guild_id, user_id, role_ids, moderator_id, reason) VALUES (?, ?, ?, ?, ?)')
                .run(guildId, userId, JSON.stringify(roleIds), moderatorId, reason).changes) > 0;
        },
        get(guildId, userId) { return toMember(db.prepare('SELECT * FROM quarantined_members WHERE guild_id = ? AND user_id = ?').get(guildId, userId)); },
        // Removes and returns the record (so a second "unquarantine" finds nothing and cannot restore twice).
        take(guildId, userId) {
            const row = db.prepare('DELETE FROM quarantined_members WHERE guild_id = ? AND user_id = ? RETURNING *').get(guildId, userId);
            return toMember(row);
        },
        list(guildId) { return db.prepare('SELECT * FROM quarantined_members WHERE guild_id = ? ORDER BY created_at').all(guildId).map(toMember); },
    };
}

module.exports = { createQuarantineService, QuarantineServiceError };
