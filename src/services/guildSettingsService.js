const { isSnowflake } = require('../utils/snowflake');

// The ONLY settings that can be changed, and the rules for each one.
// To add a setting later: add a column in a new migration, then add a line here.
const SETTINGS = {
    logChannelId: {
        column: 'log_channel_id',
        // A valid value is either a Discord ID or null (meaning "not set").
        isValid: (value) => value === null || isSnowflake(value),
    },
    appealChannelId: {
        column: 'appeal_channel_id',
        isValid: (value) => value === null || isSnowflake(value),
    },
    dmOnAction: {
        column: 'dm_on_action',
        isValid: (value) => typeof value === 'boolean',
        toDatabase: (value) => (value ? 1 : 0), // SQLite stores true/false as 1/0
    },
};

function assertGuildId(guildId) {
    if (!isSnowflake(guildId)) {
        throw new TypeError('Invalid guild ID.');
    }
}

// We pass the database in (instead of importing it) so tests can use a throwaway one.
function createGuildSettingsService(db) {
    // Prepared statements are SQL written once with "?" holes for the values.
    // The database fills the holes safely, which prevents SQL injection.
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const insertSettings = db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)');
    const selectSettings = db.prepare(
        'SELECT log_channel_id, dm_on_action, appeal_channel_id FROM guild_settings WHERE guild_id = ?'
    );

    // Makes sure the server has a row with default settings. Safe to call many times.
    function ensureGuild(guildId) {
        assertGuildId(guildId);
        insertGuild.run(guildId);
        insertSettings.run(guildId);
    }

    function getSettings(guildId) {
        ensureGuild(guildId);
        const row = selectSettings.get(guildId);
        return {
            guildId,
            logChannelId: row.log_channel_id,
            dmOnAction: row.dm_on_action === 1,
            appealChannelId: row.appeal_channel_id,
        };
    }

    function updateSetting(guildId, key, value) {
        if (!Object.hasOwn(SETTINGS, key)) {
            throw new Error(`Unknown setting: ${key}`);
        }
        const setting = SETTINGS[key];
        if (!setting.isValid(value)) {
            throw new TypeError(`Invalid value for setting "${key}".`);
        }
        const databaseValue = setting.toDatabase ? setting.toDatabase(value) : value;

        ensureGuild(guildId);
        // `setting.column` comes from our own list above, never from the user,
        // so it is safe to place in the SQL text. The value still goes in a "?" hole.
        db.prepare(
            `UPDATE guild_settings SET ${setting.column} = ?, updated_at = datetime('now') WHERE guild_id = ?`
        ).run(databaseValue, guildId);
    }

    return { ensureGuild, getSettings, updateSetting };
}

module.exports = { createGuildSettingsService };
