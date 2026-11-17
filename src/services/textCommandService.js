const { isSnowflake } = require('../utils/snowflake');

class TextCommandServiceError extends Error {} // safe to show to a moderator

const MAX_ALIASES = 50;
const MAX_DISABLED = 100;
// 1-5 characters, no spaces. Not "/" (Discord uses it for slash commands) and nothing that makes mentions or code blocks.
const PREFIX_RULE = /^[^\s/`@#<>\\*_~|]{1,5}$/u;
const ALIAS_RULE = /^[a-z0-9_-]{1,20}$/;

function createTextCommandService(db) {
    const assertGuild = (id) => { if (!isSnowflake(id)) throw new TypeError('Invalid guild ID.'); };
    function ensure(guildId) {
        assertGuild(guildId);
        db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
        db.prepare('INSERT OR IGNORE INTO text_command_config (guild_id) VALUES (?)').run(guildId);
    }
    const getConfig = (guildId) => {
        ensure(guildId);
        const r = db.prepare('SELECT * FROM text_command_config WHERE guild_id = ?').get(guildId);
        return { enabled: r.enabled === 1, prefix: r.prefix, mentionPrefix: r.mention_prefix === 1 };
    };

    return {
        MAX_ALIASES, PREFIX_RULE, ALIAS_RULE,
        getConfig,
        setEnabled(guildId, enabled) { ensure(guildId); db.prepare('UPDATE text_command_config SET enabled = ? WHERE guild_id = ?').run(enabled ? 1 : 0, guildId); },
        setPrefix(guildId, prefix) {
            if (typeof prefix !== 'string' || !PREFIX_RULE.test(prefix)) throw new TextCommandServiceError('The prefix must be 1 to 5 characters with no spaces. It cannot be `/`, and cannot contain @ # < > ` * _ ~ | or a backslash.');
            ensure(guildId);
            db.prepare('UPDATE text_command_config SET prefix = ? WHERE guild_id = ?').run(prefix, guildId);
        },
        setMentionPrefix(guildId, on) { ensure(guildId); db.prepare('UPDATE text_command_config SET mention_prefix = ? WHERE guild_id = ?').run(on ? 1 : 0, guildId); },

        disableCommand(guildId, command) {
            ensure(guildId);
            const n = db.prepare('SELECT COUNT(*) AS n FROM text_command_disabled WHERE guild_id = ?').get(guildId).n;
            if (n >= MAX_DISABLED) throw new TextCommandServiceError('Too many disabled commands.');
            return Number(db.prepare('INSERT OR IGNORE INTO text_command_disabled (guild_id, command) VALUES (?, ?)').run(guildId, command).changes) > 0;
        },
        enableCommand: (guildId, command) => Number(db.prepare('DELETE FROM text_command_disabled WHERE guild_id = ? AND command = ?').run(guildId, command).changes) > 0,
        listDisabled: (guildId) => db.prepare('SELECT command FROM text_command_disabled WHERE guild_id = ? ORDER BY command').all(guildId).map((r) => r.command),
        isDisabled: (guildId, command) => Boolean(db.prepare('SELECT 1 FROM text_command_disabled WHERE guild_id = ? AND command = ?').get(guildId, command)),

        setAlias(guildId, alias, target) {
            if (!ALIAS_RULE.test(alias)) throw new TextCommandServiceError('An alias can use a-z, 0-9, - and _ (up to 20 characters).');
            if (typeof target !== 'string' || !target.trim() || target.length > 60) throw new TextCommandServiceError('The target must be a command name, optionally with a subcommand.');
            ensure(guildId);
            const exists = db.prepare('SELECT 1 FROM text_command_aliases WHERE guild_id = ? AND alias = ?').get(guildId, alias);
            const n = db.prepare('SELECT COUNT(*) AS n FROM text_command_aliases WHERE guild_id = ?').get(guildId).n;
            if (!exists && n >= MAX_ALIASES) throw new TextCommandServiceError(`You can have at most ${MAX_ALIASES} aliases.`);
            db.prepare('INSERT INTO text_command_aliases (guild_id, alias, target) VALUES (?, ?, ?) ON CONFLICT (guild_id, alias) DO UPDATE SET target = excluded.target').run(guildId, alias, target.trim().toLowerCase());
        },
        removeAlias: (guildId, alias) => Number(db.prepare('DELETE FROM text_command_aliases WHERE guild_id = ? AND alias = ?').run(guildId, alias).changes) > 0,
        getAlias: (guildId, alias) => db.prepare('SELECT target FROM text_command_aliases WHERE guild_id = ? AND alias = ?').get(guildId, alias)?.target ?? null,
        listAliases: (guildId) => db.prepare('SELECT alias, target FROM text_command_aliases WHERE guild_id = ? ORDER BY alias').all(guildId).map((r) => ({ alias: r.alias, target: r.target })),
    };
}

module.exports = { createTextCommandService, TextCommandServiceError };
