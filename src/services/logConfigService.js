const { isSnowflake } = require('../utils/snowflake');
const { CATEGORY_NAMES } = require('../logging/categories');

const IGNORE_KINDS = ['channel', 'role', 'user'];

// Stores where each log category goes, and what should be ignored.
function createLogConfigService(db, guildSettings) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const upsertChannel = db.prepare(`
        INSERT INTO log_channels (guild_id, category, channel_id) VALUES (?, ?, ?)
        ON CONFLICT (guild_id, category) DO UPDATE SET channel_id = excluded.channel_id
    `);
    const deleteChannel = db.prepare('DELETE FROM log_channels WHERE guild_id = ? AND category = ?');
    const selectChannel = db.prepare('SELECT channel_id FROM log_channels WHERE guild_id = ? AND category = ?');
    const selectAllChannels = db.prepare('SELECT category, channel_id FROM log_channels WHERE guild_id = ?');
    const insertIgnore = db.prepare('INSERT OR IGNORE INTO log_ignores (guild_id, kind, target_id) VALUES (?, ?, ?)');
    const deleteIgnore = db.prepare('DELETE FROM log_ignores WHERE guild_id = ? AND kind = ? AND target_id = ?');
    const selectIgnore = db.prepare('SELECT 1 AS hit FROM log_ignores WHERE guild_id = ? AND kind = ? AND target_id = ?');
    const selectAllIgnores = db.prepare('SELECT kind, target_id FROM log_ignores WHERE guild_id = ? ORDER BY kind');

    function assertCategory(category) {
        if (!CATEGORY_NAMES.includes(category)) throw new TypeError(`Unknown log category: ${category}`);
    }

    function setChannel(guildId, category, channelId) {
        assertCategory(category);
        if (!isSnowflake(guildId) || !isSnowflake(channelId)) throw new TypeError('Invalid Discord ID.');
        insertGuild.run(guildId);
        upsertChannel.run(guildId, category, channelId);
    }

    // Returns true if something was removed.
    function clearChannel(guildId, category) {
        assertCategory(category);
        return deleteChannel.run(guildId, category).changes > 0;
    }

    // The channel for one category. If none was set, we fall back to the
    // general log channel from /settings set-log-channel (which may be null).
    function getChannelId(guildId, category) {
        assertCategory(category);
        const row = selectChannel.get(guildId, category);
        if (row) return row.channel_id;
        return guildSettings.getSettings(guildId).logChannelId;
    }

    function listChannels(guildId) {
        return Object.fromEntries(selectAllChannels.all(guildId).map((r) => [r.category, r.channel_id]));
    }

    function addIgnore(guildId, kind, targetId) {
        if (!IGNORE_KINDS.includes(kind)) throw new TypeError('Unknown ignore type.');
        if (!isSnowflake(guildId) || !isSnowflake(targetId)) throw new TypeError('Invalid Discord ID.');
        insertGuild.run(guildId);
        return insertIgnore.run(guildId, kind, targetId).changes > 0;
    }

    function removeIgnore(guildId, kind, targetId) {
        if (!IGNORE_KINDS.includes(kind)) throw new TypeError('Unknown ignore type.');
        return deleteIgnore.run(guildId, kind, targetId).changes > 0;
    }

    function listIgnores(guildId) {
        return selectAllIgnores.all(guildId).map((r) => ({ kind: r.kind, targetId: r.target_id }));
    }

    // Should this event be skipped because of the ignore lists?
    function isIgnored({ guildId, channelId = null, userId = null, roleIds = [] }) {
        if (channelId && selectIgnore.get(guildId, 'channel', channelId)) return true;
        if (userId && selectIgnore.get(guildId, 'user', userId)) return true;
        return roleIds.some((id) => selectIgnore.get(guildId, 'role', id));
    }

    return { setChannel, clearChannel, getChannelId, listChannels, addIgnore, removeIgnore, listIgnores, isIgnored };
}

module.exports = { createLogConfigService, IGNORE_KINDS };
