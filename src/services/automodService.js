const { isSnowflake } = require('../utils/snowflake');
const { RULES, RULE_NAMES } = require('../automod/rules');

const LIST_KINDS = ['word', 'domain', 'invite'];
const EXEMPT_KINDS = ['role', 'channel', 'user'];
const MAX_LIST_ITEMS = 500;
const CACHE_MS = 30 * 1000;

function createAutomodService(db, { now = Date.now } = {}) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const insertConfig = db.prepare('INSERT OR IGNORE INTO automod_config (guild_id) VALUES (?)');
    const selectConfig = db.prepare('SELECT * FROM automod_config WHERE guild_id = ?');
    const selectRules = db.prepare('SELECT * FROM automod_rules WHERE guild_id = ?');
    const upsertRule = db.prepare(`
        INSERT INTO automod_rules (guild_id, rule) VALUES (?, ?) ON CONFLICT (guild_id, rule) DO NOTHING
    `);
    const selectLists = db.prepare('SELECT kind, value FROM automod_lists WHERE guild_id = ?');
    const countList = db.prepare('SELECT COUNT(*) AS n FROM automod_lists WHERE guild_id = ? AND kind = ?');
    const insertList = db.prepare('INSERT OR IGNORE INTO automod_lists (guild_id, kind, value) VALUES (?, ?, ?)');
    const deleteList = db.prepare('DELETE FROM automod_lists WHERE guild_id = ? AND kind = ? AND value = ?');
    const selectExempt = db.prepare('SELECT kind, target_id FROM automod_exempt WHERE guild_id = ?');
    const insertExempt = db.prepare('INSERT OR IGNORE INTO automod_exempt (guild_id, kind, target_id) VALUES (?, ?, ?)');
    const deleteExempt = db.prepare('DELETE FROM automod_exempt WHERE guild_id = ? AND kind = ? AND target_id = ?');
    const addStrikeStmt = db.prepare('INSERT INTO automod_strikes (guild_id, user_id, rule, created_at) VALUES (?, ?, ?, ?)');
    const countStrikesStmt = db.prepare('SELECT COUNT(*) AS n FROM automod_strikes WHERE guild_id = ? AND user_id = ? AND created_at >= ?');
    const clearStrikesStmt = db.prepare('DELETE FROM automod_strikes WHERE guild_id = ? AND user_id = ?');
    const addEvent = db.prepare('INSERT INTO automod_events (guild_id, user_id, channel_id, rule, action, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const statsStmt = db.prepare('SELECT rule, COUNT(*) AS n FROM automod_events WHERE guild_id = ? AND created_at >= ? GROUP BY rule ORDER BY n DESC');
    const purgeStrikes = db.prepare('DELETE FROM automod_strikes WHERE created_at < ?');
    const purgeEvents = db.prepare('DELETE FROM automod_events WHERE created_at < ?');

    const cache = new Map(); // guildId -> { at, value }

    function ensure(guildId) {
        if (!isSnowflake(guildId)) throw new TypeError('Invalid guild ID.');
        insertGuild.run(guildId);
        insertConfig.run(guildId);
    }
    const changed = (guildId) => cache.delete(guildId);
    function checkRule(rule) { if (!RULES[rule]) throw new TypeError('Unknown rule.'); }

    function load(guildId) {
        ensure(guildId);
        const c = selectConfig.get(guildId);
        const rules = {};
        const rows = Object.fromEntries(selectRules.all(guildId).map((r) => [r.rule, r]));
        for (const name of RULE_NAMES) {
            const def = RULES[name];
            const row = rows[name];
            rules[name] = {
                enabled: row?.enabled == null ? def.enabled : row.enabled === 1,
                action: row?.action ?? def.action,
                limit: row?.limit_value ?? def.limit,
                window: row?.window_seconds ?? def.window,
            };
        }
        const lists = { word: [], domain: [], invite: [] };
        for (const r of selectLists.all(guildId)) lists[r.kind].push(r.value);
        const exempt = { role: [], channel: [], user: [] };
        for (const r of selectExempt.all(guildId)) exempt[r.kind].push(r.target_id);
        return {
            guildId, enabled: c.enabled === 1, strikeLimit: c.strike_limit, strikeWindowMinutes: c.strike_window_minutes,
            timeoutMinutes: c.timeout_minutes, rules, lists, exempt,
        };
    }

    function getConfig(guildId) {
        const hit = cache.get(guildId);
        if (hit && hit.at > now() - CACHE_MS) return hit.value;
        const value = load(guildId);
        cache.set(guildId, { at: now(), value });
        return value;
    }

    // `column` is always a fixed name from this file, never user text.
    function setConfigColumn(guildId, column, value) {
        ensure(guildId);
        db.prepare(`UPDATE automod_config SET ${column} = ? WHERE guild_id = ?`).run(value, guildId);
        changed(guildId);
    }
    function setRuleColumn(guildId, rule, column, value) {
        checkRule(rule);
        ensure(guildId);
        upsertRule.run(guildId, rule);
        db.prepare(`UPDATE automod_rules SET ${column} = ? WHERE guild_id = ? AND rule = ?`).run(value, guildId, rule);
        changed(guildId);
    }
    const inRange = (n, [lo, hi], what) => {
        if (!Number.isInteger(n) || n < lo || n > hi) throw new TypeError(`${what} must be between ${lo} and ${hi}.`);
    };

    return {
        getConfig,
        setEnabled: (g, v) => setConfigColumn(g, 'enabled', v ? 1 : 0),
        setPunishment(g, { strikeLimit, strikeWindowMinutes, timeoutMinutes }) {
            if (strikeLimit != null) { inRange(strikeLimit, [1, 20], 'Strikes'); setConfigColumn(g, 'strike_limit', strikeLimit); }
            if (strikeWindowMinutes != null) { inRange(strikeWindowMinutes, [1, 1440], 'Window'); setConfigColumn(g, 'strike_window_minutes', strikeWindowMinutes); }
            if (timeoutMinutes != null) { inRange(timeoutMinutes, [1, 40320], 'Timeout'); setConfigColumn(g, 'timeout_minutes', timeoutMinutes); }
        },
        setRule(g, rule, { enabled, action, limit, window } = {}) {
            checkRule(rule);
            const def = RULES[rule];
            if (enabled != null) setRuleColumn(g, rule, 'enabled', enabled ? 1 : 0);
            if (action != null) {
                if (!['delete', 'timeout', 'kick'].includes(action)) throw new TypeError('Unknown action.');
                setRuleColumn(g, rule, 'action', action);
            }
            if (limit != null) {
                if (!def.limitRange) throw new TypeError(`The "${def.label}" rule has no limit to change.`);
                inRange(limit, def.limitRange, `Limit (${def.limitMeaning})`);
                setRuleColumn(g, rule, 'limit_value', limit);
            }
            if (window != null) {
                if (!def.windowRange) throw new TypeError(`The "${def.label}" rule has no time window to change.`);
                inRange(window, def.windowRange, 'Window (seconds)');
                setRuleColumn(g, rule, 'window_seconds', window);
            }
        },
        resetRule(g, rule) {
            checkRule(rule);
            db.prepare('DELETE FROM automod_rules WHERE guild_id = ? AND rule = ?').run(g, rule);
            changed(g);
        },

        addListItem(g, kind, rawValue) {
            if (!LIST_KINDS.includes(kind)) throw new TypeError('Unknown list.');
            ensure(g);
            let value = String(rawValue).trim().toLowerCase();
            if (kind === 'domain') value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
            if (kind === 'invite') value = value.replace(/^.*\//, '');
            if (value.length < 2 || value.length > 100) throw new TypeError('That value must be 2-100 characters.');
            if (countList.get(g, kind).n >= MAX_LIST_ITEMS) throw new TypeError(`A list can hold at most ${MAX_LIST_ITEMS} items.`);
            const added = insertList.run(g, kind, value).changes > 0;
            changed(g);
            return { added, value };
        },
        removeListItem(g, kind, rawValue) {
            if (!LIST_KINDS.includes(kind)) throw new TypeError('Unknown list.');
            let value = String(rawValue).trim().toLowerCase();
            if (kind === 'domain') value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
            if (kind === 'invite') value = value.replace(/^.*\//, '');
            const removed = deleteList.run(g, kind, value).changes > 0;
            changed(g);
            return removed;
        },

        addExempt(g, kind, id) {
            if (!EXEMPT_KINDS.includes(kind) || !isSnowflake(id)) throw new TypeError('Invalid exemption.');
            ensure(g);
            const added = insertExempt.run(g, kind, id).changes > 0;
            changed(g);
            return added;
        },
        removeExempt(g, kind, id) {
            const removed = deleteExempt.run(g, kind, id).changes > 0;
            changed(g);
            return removed;
        },

        addStrike: (g, userId, rule, at = now()) => { ensure(g); addStrikeStmt.run(g, userId, rule, at); },
        countStrikes: (g, userId, sinceMs) => countStrikesStmt.get(g, userId, sinceMs).n,
        clearStrikes: (g, userId) => clearStrikesStmt.run(g, userId).changes,
        recordEvent: (g, userId, channelId, rule, action, at = now()) => { ensure(g); addEvent.run(g, userId, channelId, rule, action, at); },
        stats: (g, sinceMs) => statsStmt.all(g, sinceMs),
        purgeOld(olderThanMs) { purgeStrikes.run(olderThanMs); purgeEvents.run(olderThanMs); },
    };
}

module.exports = { createAutomodService, MAX_LIST_ITEMS };
