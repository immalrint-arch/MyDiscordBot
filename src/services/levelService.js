const { isSnowflake } = require('../utils/snowflake');
const { levelFromXp, totalXpForLevel, rollXp, applyMultipliers, dayNumber, MAX_LEVEL } = require('../leveling/xpMath');

class LevelServiceError extends Error {} // safe to show to a moderator

const MAX_LEVEL_ROLES = 50;
const MAX_LIST = 25;

// friendly name -> { column, check }
const SETTINGS = {
    enabled: { column: 'enabled', check: 'bool' },
    xpMin: { column: 'xp_min', check: 'int:1:500' },
    xpMax: { column: 'xp_max', check: 'int:1:500' },
    cooldownSeconds: { column: 'cooldown_seconds', check: 'int:0:3600' },
    minLength: { column: 'min_length', check: 'int:0:100' },
    voiceXp: { column: 'voice_xp', check: 'int:0:100' },
    multiplierPercent: { column: 'multiplier_percent', check: 'int:10:1000' },
    announceMode: { column: 'announce_mode', check: 'enum:channel,current,dm,off' },
    announceChannelId: { column: 'announce_channel_id', check: 'id?' },
    announceStyle: { column: 'announce_style', check: 'enum:card,embed,text' },
    levelupMessage: { column: 'levelup_message', check: 'text:1000' },
    levelupPing: { column: 'levelup_ping', check: 'bool' },
    rewardMode: { column: 'reward_mode', check: 'enum:stack,replace' },
    highlightsChannelId: { column: 'highlights_channel_id', check: 'id?' },
    highlightsPeriod: { column: 'highlights_period', check: 'enum:off,daily,weekly,monthly' },
    highlightsLast: { column: 'highlights_last', check: 'int:0:99999999' },
};

function validate(check, value, name) {
    if (check === 'bool') return value ? 1 : 0;
    if (check === 'id?') {
        if (value !== null && !isSnowflake(value)) throw new TypeError('Invalid channel.');
        return value;
    }
    const [kind, a, b] = check.split(':');
    if (kind === 'int') {
        if (!Number.isInteger(value) || value < Number(a) || value > Number(b)) throw new TypeError(`${name} must be a whole number from ${a} to ${b}.`);
        return value;
    }
    if (kind === 'enum') {
        if (!a.split(',').includes(value)) throw new TypeError(`${name} must be one of: ${a.split(',').join(', ')}.`);
        return value;
    }
    if (kind === 'text') {
        if (typeof value !== 'string' || value.trim() === '') throw new TypeError('The text cannot be empty.');
        if (value.length > Number(a)) throw new TypeError(`The text can be at most ${a} characters.`);
        return value;
    }
    throw new Error('Unknown check');
}

const toConfig = (r) => ({
    enabled: r.enabled === 1, xpMin: r.xp_min, xpMax: r.xp_max, cooldownSeconds: r.cooldown_seconds, minLength: r.min_length,
    voiceXp: r.voice_xp, multiplierPercent: r.multiplier_percent, announceMode: r.announce_mode, announceChannelId: r.announce_channel_id,
    announceStyle: r.announce_style, levelupMessage: r.levelup_message, levelupPing: r.levelup_ping === 1, rewardMode: r.reward_mode,
    highlightsChannelId: r.highlights_channel_id, highlightsPeriod: r.highlights_period, highlightsLast: r.highlights_last,
});

function createLevelService(db, { now = Date.now, rng = Math.random } = {}) {
    const assertGuild = (id) => { if (!isSnowflake(id)) throw new TypeError('Invalid guild ID.'); };
    const assertId = (id, what) => { if (!isSnowflake(id)) throw new TypeError(`Invalid ${what}.`); };
    function ensure(guildId) {
        assertGuild(guildId);
        db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
        db.prepare('INSERT OR IGNORE INTO level_config (guild_id) VALUES (?)').run(guildId);
    }
    const getConfig = (guildId) => { ensure(guildId); return toConfig(db.prepare('SELECT * FROM level_config WHERE guild_id = ?').get(guildId)); };

    function setConfig(guildId, changes) {
        ensure(guildId);
        const current = getConfig(guildId);
        const checked = [];
        for (const [key, value] of Object.entries(changes)) {
            const rule = SETTINGS[key];
            if (!rule) throw new TypeError(`There is no setting called ${key}.`);
            checked.push([key, rule.column, validate(rule.check, value, key)]);
        }
        const merged = { ...current, ...changes };
        if (merged.xpMin > merged.xpMax) throw new TypeError('The minimum XP cannot be higher than the maximum.');
        db.exec('BEGIN');
        try {
            for (const [, column, value] of checked) db.prepare(`UPDATE level_config SET ${column} = ? WHERE guild_id = ?`).run(value, guildId);
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
    }

    function resetConfig(guildId) {
        ensure(guildId);
        db.prepare('DELETE FROM level_config WHERE guild_id = ?').run(guildId);
        db.prepare('INSERT INTO level_config (guild_id) VALUES (?)').run(guildId);
    }

    const lists = {
        ignores: (guildId) => db.prepare('SELECT kind, target_id FROM level_ignores WHERE guild_id = ?').all(guildId).map((r) => ({ kind: r.kind, id: r.target_id })),
        boosts: (guildId) => db.prepare('SELECT role_id, percent FROM level_boosts WHERE guild_id = ?').all(guildId).map((r) => ({ roleId: r.role_id, percent: r.percent })),
    };

    // Adds XP (or removes it, if negative). Returns what changed, or null.
    function addXp(guildId, userId, amount, { countMessage = false, touch = false } = {}) {
        ensure(guildId); assertId(userId, 'user');
        db.prepare('INSERT OR IGNORE INTO level_users (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
        const row = db.prepare('SELECT xp, level FROM level_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
        const xp = Math.max(0, row.xp + Math.trunc(amount));
        const level = levelFromXp(xp);
        db.prepare('UPDATE level_users SET xp = ?, level = ?, messages = messages + ?, last_xp_at = CASE WHEN ? THEN ? ELSE last_xp_at END WHERE guild_id = ? AND user_id = ?')
            .run(xp, level, countMessage ? 1 : 0, touch ? 1 : 0, now(), guildId, userId);
        if (amount > 0) {
            const day = dayNumber(now());
            const gainedLevels = Math.max(0, level - row.level);
            db.prepare(`INSERT INTO level_daily (guild_id, user_id, day, xp, levels) VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT (guild_id, user_id, day) DO UPDATE SET xp = xp + excluded.xp, levels = levels + excluded.levels`)
                .run(guildId, userId, day, Math.trunc(amount), gainedLevels);
        }
        return { xp, level, oldLevel: row.level, leveledUp: level > row.level };
    }

    return {
        MAX_LEVEL_ROLES, SETTINGS: Object.keys(SETTINGS),
        getConfig, setConfig, resetConfig,

        // A message was sent. Returns null when no XP is given (off, ignored, too short, cooldown).
        awardMessage({ guildId, userId, channelId, roleIds = [], contentLength = 0 }) {
            const config = getConfig(guildId);
            if (!config.enabled) return null;
            if (contentLength < config.minLength) return null;
            const ignores = lists.ignores(guildId);
            if (ignores.some((i) => (i.kind === 'channel' && i.id === channelId) || (i.kind === 'role' && roleIds.includes(i.id)))) return null;
            const last = db.prepare('SELECT last_xp_at FROM level_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
            if (last && now() - last.last_xp_at < config.cooldownSeconds * 1000) return null;
            const boosts = lists.boosts(guildId).filter((b) => roleIds.includes(b.roleId)).map((b) => b.percent);
            const gained = applyMultipliers(rollXp(config.xpMin, config.xpMax, rng), config.multiplierPercent, boosts);
            return { gained, ...addXp(guildId, userId, gained, { countMessage: true, touch: true }) };
        },

        // XP for time spent in voice (called once a minute by the scheduler).
        awardVoice({ guildId, userId, roleIds = [], channelId }) {
            const config = getConfig(guildId);
            if (!config.enabled || config.voiceXp <= 0) return null;
            const ignores = lists.ignores(guildId);
            if (ignores.some((i) => (i.kind === 'channel' && i.id === channelId) || (i.kind === 'role' && roleIds.includes(i.id)))) return null;
            const boosts = lists.boosts(guildId).filter((b) => roleIds.includes(b.roleId)).map((b) => b.percent);
            const gained = applyMultipliers(config.voiceXp, config.multiplierPercent, boosts);
            return { gained, ...addXp(guildId, userId, gained) };
        },

        addXp,
        setLevel(guildId, userId, level) {
            if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) throw new LevelServiceError(`Level must be from 0 to ${MAX_LEVEL}.`);
            ensure(guildId); assertId(userId, 'user');
            db.prepare('INSERT OR IGNORE INTO level_users (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
            const old = db.prepare('SELECT level FROM level_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId).level;
            db.prepare('UPDATE level_users SET xp = ?, level = ? WHERE guild_id = ? AND user_id = ?').run(totalXpForLevel(level), level, guildId, userId);
            return { oldLevel: old, level };
        },
        resetUser(guildId, userId) {
            const a = db.prepare('DELETE FROM level_users WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
            db.prepare('DELETE FROM level_daily WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
            return Number(a.changes) > 0;
        },
        resetGuild(guildId) {
            assertGuild(guildId);
            const a = db.prepare('DELETE FROM level_users WHERE guild_id = ?').run(guildId);
            db.prepare('DELETE FROM level_daily WHERE guild_id = ?').run(guildId);
            return Number(a.changes);
        },

        getUser(guildId, userId) {
            const r = db.prepare('SELECT * FROM level_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
            return r ? { xp: r.xp, level: r.level, messages: r.messages } : { xp: 0, level: 0, messages: 0 };
        },
        // 1 = best. null when the person has no XP.
        getRank(guildId, userId) {
            const me = db.prepare('SELECT xp FROM level_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
            if (!me || me.xp <= 0) return null;
            return db.prepare('SELECT COUNT(*) AS n FROM level_users WHERE guild_id = ? AND xp > ?').get(guildId, me.xp).n + 1;
        },
        top(guildId, { limit = 10, offset = 0 } = {}) {
            return db.prepare('SELECT user_id, xp, level FROM level_users WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC, user_id LIMIT ? OFFSET ?')
                .all(guildId, limit, offset).map((r) => ({ userId: r.user_id, xp: r.xp, level: r.level, levels: r.level }));
        },
        countRanked(guildId) { return db.prepare('SELECT COUNT(*) AS n FROM level_users WHERE guild_id = ? AND xp > 0').get(guildId).n; },
        // Who earned the most XP between two days. `levels` = levels gained in that time.
        topPeriod(guildId, startDay, endDay, { limit = 10, offset = 0 } = {}) {
            return db.prepare(`SELECT user_id, SUM(xp) AS xp, SUM(levels) AS levels FROM level_daily
                               WHERE guild_id = ? AND day BETWEEN ? AND ? GROUP BY user_id HAVING SUM(xp) > 0
                               ORDER BY xp DESC, user_id LIMIT ? OFFSET ?`).all(guildId, startDay, endDay, limit, offset)
                .map((r) => ({ userId: r.user_id, xp: r.xp, levels: r.levels }));
        },
        countPeriod(guildId, startDay, endDay) {
            return db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM level_daily WHERE guild_id = ? AND day BETWEEN ? AND ? AND xp > 0').get(guildId, startDay, endDay).n;
        },
        purgeOldDaily(beforeDay) { db.prepare('DELETE FROM level_daily WHERE day < ?').run(beforeDay); },

        // ---------- level roles ----------
        setLevelRole(guildId, level, roleId) {
            ensure(guildId); assertId(roleId, 'role');
            if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new LevelServiceError(`Level must be from 1 to ${MAX_LEVEL}.`);
            const exists = db.prepare('SELECT 1 FROM level_roles WHERE guild_id = ? AND level = ?').get(guildId, level);
            const count = db.prepare('SELECT COUNT(*) AS n FROM level_roles WHERE guild_id = ?').get(guildId).n;
            if (!exists && count >= MAX_LEVEL_ROLES) throw new LevelServiceError(`You can have at most ${MAX_LEVEL_ROLES} level roles.`);
            db.prepare('INSERT INTO level_roles (guild_id, level, role_id) VALUES (?, ?, ?) ON CONFLICT (guild_id, level) DO UPDATE SET role_id = excluded.role_id').run(guildId, level, roleId);
        },
        removeLevelRole(guildId, level) { return Number(db.prepare('DELETE FROM level_roles WHERE guild_id = ? AND level = ?').run(guildId, level).changes) > 0; },
        listLevelRoles(guildId) { return db.prepare('SELECT level, role_id FROM level_roles WHERE guild_id = ? ORDER BY level').all(guildId).map((r) => ({ level: r.level, roleId: r.role_id })); },
        removeRoleEverywhere(guildId, roleId) {
            db.prepare('DELETE FROM level_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
            db.prepare('DELETE FROM level_boosts WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
            db.prepare("DELETE FROM level_ignores WHERE guild_id = ? AND kind = 'role' AND target_id = ?").run(guildId, roleId);
        },

        // ---------- ignores and boosts ----------
        addIgnore(guildId, kind, targetId) {
            ensure(guildId); assertId(targetId, 'target');
            if (!['channel', 'role'].includes(kind)) throw new TypeError('Invalid kind.');
            if (lists.ignores(guildId).length >= 100) throw new LevelServiceError('You can ignore at most 100 channels and roles.');
            return Number(db.prepare('INSERT OR IGNORE INTO level_ignores (guild_id, kind, target_id) VALUES (?, ?, ?)').run(guildId, kind, targetId).changes) > 0;
        },
        removeIgnore(guildId, kind, targetId) { return Number(db.prepare('DELETE FROM level_ignores WHERE guild_id = ? AND kind = ? AND target_id = ?').run(guildId, kind, targetId).changes) > 0; },
        listIgnores: lists.ignores,
        setBoost(guildId, roleId, percent) {
            ensure(guildId); assertId(roleId, 'role');
            if (!Number.isInteger(percent) || percent < 10 || percent > 500) throw new LevelServiceError('Boost must be from 10 to 500 (150 = 1.5x XP).');
            if (lists.boosts(guildId).length >= MAX_LIST && !lists.boosts(guildId).some((b) => b.roleId === roleId)) throw new LevelServiceError(`You can have at most ${MAX_LIST} boosts.`);
            db.prepare('INSERT INTO level_boosts (guild_id, role_id, percent) VALUES (?, ?, ?) ON CONFLICT (guild_id, role_id) DO UPDATE SET percent = excluded.percent').run(guildId, roleId, percent);
        },
        removeBoost(guildId, roleId) { return Number(db.prepare('DELETE FROM level_boosts WHERE guild_id = ? AND role_id = ?').run(guildId, roleId).changes) > 0; },
        listBoosts: lists.boosts,

        // ---------- schedulers ----------
        guildsWithVoiceXp() { return db.prepare('SELECT guild_id FROM level_config WHERE enabled = 1 AND voice_xp > 0').all().map((r) => r.guild_id); },
        guildsWithHighlights() {
            return db.prepare("SELECT guild_id FROM level_config WHERE enabled = 1 AND highlights_period != 'off' AND highlights_channel_id IS NOT NULL").all().map((r) => r.guild_id);
        },
    };
}

module.exports = { createLevelService, LevelServiceError };
