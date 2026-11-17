const { isSnowflake } = require('../utils/snowflake');

// Which settings exist for each kind of message, and how each one is checked.
const STYLES = ['embed', 'text', 'card'];
const RULES = {
    welcome: {
        enabled: { column: 'welcome_enabled', check: 'bool' },
        channelId: { column: 'welcome_channel_id', check: 'channel' },
        style: { column: 'welcome_style', check: 'style' },
        title: { column: 'welcome_title', check: 'text:150' },
        message: { column: 'welcome_message', check: 'text:1800' },
        color: { column: 'welcome_color', check: 'color' },
        footer: { column: 'welcome_footer', check: 'text?:150' },
        bannerUrl: { column: 'welcome_banner_url', check: 'url?' },
        ping: { column: 'welcome_ping', check: 'bool' },
        deleteAfter: { column: 'welcome_delete_after', check: 'seconds' },
        timing: { column: 'welcome_timing', check: 'timing' },
        bots: { column: 'welcome_bots', check: 'bool' },
        dmEnabled: { column: 'dm_enabled', check: 'bool' },
        dmMessage: { column: 'dm_message', check: 'text:1800' },
    },
    goodbye: {
        enabled: { column: 'goodbye_enabled', check: 'bool' },
        channelId: { column: 'goodbye_channel_id', check: 'channel' },
        style: { column: 'goodbye_style', check: 'style' },
        title: { column: 'goodbye_title', check: 'text:150' },
        message: { column: 'goodbye_message', check: 'text:1800' },
        color: { column: 'goodbye_color', check: 'color' },
        footer: { column: 'goodbye_footer', check: 'text?:150' },
        bannerUrl: { column: 'goodbye_banner_url', check: 'url?' },
        deleteAfter: { column: 'goodbye_delete_after', check: 'seconds' },
        bots: { column: 'goodbye_bots', check: 'bool' },
    },
};

// Returns the value to store, or throws a TypeError with a message that is safe to show.
function validate(check, value) {
    if (check === 'bool') return value ? 1 : 0;
    if (check === 'channel') {
        if (value !== null && !isSnowflake(value)) throw new TypeError('Invalid channel.');
        return value;
    }
    if (check === 'style') {
        if (!STYLES.includes(value)) throw new TypeError('Style must be embed, text or card.');
        return value;
    }
    if (check === 'timing') {
        if (!['join', 'verified'].includes(value)) throw new TypeError('Timing must be join or verified.');
        return value;
    }
    if (check === 'color') {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new TypeError('Invalid colour.');
        return value;
    }
    if (check === 'seconds') {
        if (!Number.isInteger(value) || value < 0 || value > 86400) throw new TypeError('Seconds must be 0 to 86400.');
        return value;
    }
    if (check === 'url?') {
        if (value === null) return null;
        if (typeof value !== 'string' || value.length > 300 || !/^https:\/\/[^\s]+$/i.test(value)) throw new TypeError('The picture link must start with https://');
        return value;
    }
    const [kind, max] = check.split(':'); // "text:150" or "text?:150"
    const optional = kind === 'text?';
    if (value === null && optional) return null;
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError('The text cannot be empty.');
    if (value.length > Number(max)) throw new TypeError(`The text can be at most ${max} characters.`);
    return value;
}

function createWelcomeService(db) {
    function ensure(guildId) {
        if (!isSnowflake(guildId)) throw new TypeError('Invalid guild ID.');
        db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
        db.prepare('INSERT OR IGNORE INTO welcome_config (guild_id) VALUES (?)').run(guildId);
    }

    // Returns the settings of one kind ('welcome' or 'goodbye') with friendly names.
    function get(guildId, kind) {
        if (!RULES[kind]) throw new TypeError('Unknown kind.');
        ensure(guildId);
        const row = db.prepare('SELECT * FROM welcome_config WHERE guild_id = ?').get(guildId);
        const out = {};
        for (const [key, rule] of Object.entries(RULES[kind])) {
            const value = row[rule.column];
            out[key] = rule.check === 'bool' ? value === 1 : value;
        }
        return out;
    }

    // changes: { message: '...', enabled: true, ... } using the friendly names above.
    function set(guildId, kind, changes) {
        if (!RULES[kind]) throw new TypeError('Unknown kind.');
        ensure(guildId);
        const checked = [];
        for (const [key, value] of Object.entries(changes)) {
            const rule = RULES[kind][key];
            if (!rule) throw new TypeError(`${kind} has no setting called ${key}.`);
            checked.push([rule.column, validate(rule.check, value)]);
        }
        db.exec('BEGIN');
        try {
            for (const [column, value] of checked) db.prepare(`UPDATE welcome_config SET ${column} = ? WHERE guild_id = ?`).run(value, guildId);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }

    // Puts every setting of one kind back to its default. The other kind is left untouched.
    function reset(guildId, kind) {
        if (!RULES[kind]) throw new TypeError('Unknown kind.');
        ensure(guildId);
        const row = db.prepare('SELECT * FROM welcome_config WHERE guild_id = ?').get(guildId);
        const keep = Object.entries(RULES)
            .filter(([name]) => name !== kind)
            .flatMap(([, rules]) => Object.values(rules).map((r) => [r.column, row[r.column]]));
        db.exec('BEGIN');
        try {
            db.prepare('DELETE FROM welcome_config WHERE guild_id = ?').run(guildId); // the table's defaults come back on insert
            db.prepare('INSERT INTO welcome_config (guild_id) VALUES (?)').run(guildId);
            for (const [column, value] of keep) db.prepare(`UPDATE welcome_config SET ${column} = ? WHERE guild_id = ?`).run(value, guildId);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }

    return { get, set, reset };
}

module.exports = { createWelcomeService, STYLES };
