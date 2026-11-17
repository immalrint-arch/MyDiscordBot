const { isSnowflake } = require('../utils/snowflake');

const MAX_MESSAGE = 1000;

function toAppeal(row) {
    if (!row) return null;
    return {
        id: row.id, guildId: row.guild_id, userId: row.user_id, banCaseNumber: row.ban_case_number,
        message: row.message, status: row.status, resolvedBy: row.resolved_by, resolvedAt: row.resolved_at,
        channelId: row.channel_id, messageId: row.message_id, createdAt: row.created_at,
    };
}

// Stores ban appeals and the "may not appeal" list.
function createAppealService(db) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const insert = db.prepare('INSERT INTO ban_appeals (guild_id, user_id, ban_case_number, message) VALUES (?, ?, ?, ?) RETURNING *');
    const selectById = db.prepare('SELECT * FROM ban_appeals WHERE id = ?');
    const selectPending = db.prepare("SELECT * FROM ban_appeals WHERE guild_id = ? AND user_id = ? AND status = 'pending' LIMIT 1");
    // "AND status = 'pending'" makes resolving atomic: two moderators clicking at once cannot both win.
    const resolve = db.prepare("UPDATE ban_appeals SET status = ?, resolved_by = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'");
    const setMessage = db.prepare('UPDATE ban_appeals SET channel_id = ?, message_id = ? WHERE id = ?');
    const remove = db.prepare('DELETE FROM ban_appeals WHERE id = ?');
    const addBlack = db.prepare('INSERT OR IGNORE INTO appeal_blacklist (guild_id, user_id) VALUES (?, ?)');
    const delBlack = db.prepare('DELETE FROM appeal_blacklist WHERE guild_id = ? AND user_id = ?');
    const hasBlack = db.prepare('SELECT 1 AS hit FROM appeal_blacklist WHERE guild_id = ? AND user_id = ?');

    function create({ guildId, userId, banCaseNumber = null, message }) {
        if (!isSnowflake(guildId) || !isSnowflake(userId)) throw new TypeError('Invalid Discord ID.');
        if (typeof message !== 'string' || message.trim().length === 0 || message.length > MAX_MESSAGE) {
            throw new TypeError('Invalid appeal message.');
        }
        insertGuild.run(guildId);
        return toAppeal(insert.get(guildId, userId, banCaseNumber, message.trim()));
    }

    return {
        create,
        get: (id) => toAppeal(selectById.get(id)),
        findPending: (guildId, userId) => toAppeal(selectPending.get(guildId, userId)),
        // status: approved | denied | blacklisted | dismissed. Returns false if it was already resolved.
        resolve: (id, status, moderatorId) => resolve.run(status, moderatorId, id).changes > 0,
        attachMessage: (id, channelId, messageId) => setMessage.run(channelId, messageId, id),
        discard: (id) => remove.run(id),
        blacklist: (guildId, userId) => { insertGuild.run(guildId); addBlack.run(guildId, userId); },
        unblacklist: (guildId, userId) => delBlack.run(guildId, userId).changes > 0,
        isBlacklisted: (guildId, userId) => Boolean(hasBlack.get(guildId, userId)),
    };
}

module.exports = { createAppealService, MAX_MESSAGE };
