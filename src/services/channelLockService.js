const { isSnowflake } = require('../utils/snowflake');

const STATES = ['allow', 'deny', 'neutral'];
const SOURCES = ['lock', 'lockdown']; // "lock" = one channel by /lock, "lockdown" = whole server

// Remembers what a channel's "Send Messages" permission for @everyone was
// before /lock or /lockdown, so unlocking can restore it exactly.
function createChannelLockService(db) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const saveStatement = db.prepare(`
        INSERT OR REPLACE INTO channel_locks (guild_id, channel_id, previous_state, locked_by, source)
        VALUES (?, ?, ?, ?, ?)
    `);
    const selectStatement = db.prepare(
        'SELECT previous_state, locked_by, locked_at, source FROM channel_locks WHERE guild_id = ? AND channel_id = ?'
    );
    const deleteStatement = db.prepare('DELETE FROM channel_locks WHERE guild_id = ? AND channel_id = ?');
    const selectBySource = db.prepare(
        'SELECT channel_id, previous_state FROM channel_locks WHERE guild_id = ? AND source = ?'
    );

    function saveLock({ guildId, channelId, previousState, lockedBy, source = 'lock' }) {
        if (!isSnowflake(guildId) || !isSnowflake(channelId) || !isSnowflake(lockedBy)) {
            throw new TypeError('Invalid Discord ID.');
        }
        if (!STATES.includes(previousState)) throw new TypeError('Invalid previous state.');
        if (!SOURCES.includes(source)) throw new TypeError('Invalid lock source.');
        insertGuild.run(guildId);
        saveStatement.run(guildId, channelId, previousState, lockedBy, source);
    }

    function getLock(guildId, channelId) {
        const row = selectStatement.get(guildId, channelId);
        if (!row) return null;
        return { previousState: row.previous_state, lockedBy: row.locked_by, lockedAt: row.locked_at, source: row.source };
    }

    function clearLock(guildId, channelId) {
        deleteStatement.run(guildId, channelId);
    }

    // Every channel locked by one source, e.g. all channels closed by /lockdown.
    function listBySource(guildId, source) {
        return selectBySource.all(guildId, source).map((r) => ({ channelId: r.channel_id, previousState: r.previous_state }));
    }

    return { saveLock, getLock, clearLock, listBySource };
}

module.exports = { createChannelLockService };
