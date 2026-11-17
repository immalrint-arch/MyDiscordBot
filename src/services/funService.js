const { isSnowflake } = require('../utils/snowflake');

class FunServiceError extends Error {}
const GAMES = ['trivia', 'rps', 'tictactoe', 'connect4', 'guess', 'hangman'];

function createFunService(db, { now = Date.now } = {}) {
    const ensure = (guildId) => { if (!isSnowflake(guildId)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId); };
    const bool = (v) => (v ? 1 : 0);

    // ---------- settings ----------
    const getConfig = (guildId) => {
        const r = db.prepare('SELECT * FROM fun_config WHERE guild_id = ?').get(guildId);
        return { gamesEnabled: r ? Boolean(r.games_enabled) : true, gamesChannelId: r?.games_channel_id ?? null, afkEnabled: r ? Boolean(r.afk_enabled) : true };
    };
    const setConfig = (guildId, patch) => {
        ensure(guildId); const c = { ...getConfig(guildId), ...patch };
        db.prepare(`INSERT INTO fun_config (guild_id, games_enabled, games_channel_id, afk_enabled) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id) DO UPDATE SET games_enabled = excluded.games_enabled, games_channel_id = excluded.games_channel_id, afk_enabled = excluded.afk_enabled`)
            .run(guildId, bool(c.gamesEnabled), c.gamesChannelId, bool(c.afkEnabled));
        return c;
    };

    // ---------- birthdays ----------
    const bdConfig = (guildId) => { const r = db.prepare('SELECT * FROM birthday_config WHERE guild_id = ?').get(guildId); return { channelId: r?.channel_id ?? null, roleId: r?.role_id ?? null, message: r?.message ?? null }; };
    const toBd = (r) => (r ? { guildId: r.guild_id, userId: r.user_id, month: r.month, day: r.day, year: r.year, utcOffset: r.utc_offset } : null);

    // ---------- counting ----------
    const toCount = (r) => ({ channelId: r?.channel_id ?? null, current: r?.current ?? 0, lastUserId: r?.last_user_id ?? null, record: r?.record ?? 0 });
    const countConfig = (guildId) => toCount(db.prepare('SELECT * FROM counting_config WHERE guild_id = ?').get(guildId));
    const bumpOf = (r) => ({ channelId: r?.channel_id ?? null, roleId: r?.role_id ?? null, nextAt: r?.next_at ?? null, waiting: r ? r.reminded === 0 : false });

    return {
        getConfig, setConfig,

        birthdays: {
            getConfig: bdConfig,
            setConfig(guildId, patch) {
                ensure(guildId); const c = { ...bdConfig(guildId), ...patch };
                db.prepare(`INSERT INTO birthday_config (guild_id, channel_id, role_id, message) VALUES (?, ?, ?, ?)
                    ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, role_id = excluded.role_id, message = excluded.message`).run(guildId, c.channelId, c.roleId, c.message);
                return c;
            },
            set(guildId, userId, { month, day, year = null, utcOffset = 0 }) {
                ensure(guildId); if (!isSnowflake(userId)) throw new TypeError('Invalid user ID.');
                db.prepare(`INSERT INTO birthdays (guild_id, user_id, month, day, year, utc_offset) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT (guild_id, user_id) DO UPDATE SET month = excluded.month, day = excluded.day, year = excluded.year, utc_offset = excluded.utc_offset`).run(guildId, userId, month, day, year, utcOffset);
                return toBd(db.prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?').get(guildId, userId));
            },
            get: (guildId, userId) => toBd(db.prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?').get(guildId, userId)),
            remove: (guildId, userId) => Number(db.prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes) > 0,
            list: (guildId) => db.prepare('SELECT * FROM birthdays WHERE guild_id = ?').all(guildId).map(toBd),
            // Guilds that want announcements or roles.
            configuredGuilds: () => db.prepare('SELECT guild_id FROM birthday_config WHERE channel_id IS NOT NULL OR role_id IS NOT NULL').all().map((r) => r.guild_id),
            // Returns true only the first time (so a birthday is announced once).
            claim: (guildId, userId, date) => Number(db.prepare('INSERT OR IGNORE INTO birthday_log (guild_id, user_id, date) VALUES (?, ?, ?)').run(guildId, userId, date).changes) > 0,
            purgeLog: (beforeDate) => db.prepare('DELETE FROM birthday_log WHERE date < ?').run(beforeDate),
            trackRole(guildId, userId, roleId, expiresAt) { db.prepare('INSERT OR REPLACE INTO birthday_roles (guild_id, user_id, role_id, expires_at) VALUES (?, ?, ?, ?)').run(guildId, userId, roleId, expiresAt); },
            dueRoles: (nowMs) => db.prepare('SELECT * FROM birthday_roles WHERE expires_at <= ?').all(nowMs).map((r) => ({ guildId: r.guild_id, userId: r.user_id, roleId: r.role_id })),
            untrackRole(guildId, userId) { db.prepare('DELETE FROM birthday_roles WHERE guild_id = ? AND user_id = ?').run(guildId, userId); },
        },

        afk: {
            set(guildId, userId, reason) {
                ensure(guildId); if (!isSnowflake(userId)) throw new TypeError('Invalid user ID.');
                const since = now(); db.prepare('INSERT OR REPLACE INTO afk (guild_id, user_id, reason, since) VALUES (?, ?, ?, ?)').run(guildId, userId, String(reason).slice(0, 100), since);
                return { reason: String(reason).slice(0, 100), since };
            },
            get: (guildId, userId) => { const r = db.prepare('SELECT * FROM afk WHERE guild_id = ? AND user_id = ?').get(guildId, userId); return r ? { reason: r.reason, since: r.since } : null; },
            // Removes and returns the old entry (null if the user was not AFK): only the first caller gets it.
            clear(guildId, userId) { const r = db.prepare('DELETE FROM afk WHERE guild_id = ? AND user_id = ? RETURNING *').get(guildId, userId); return r ? { reason: r.reason, since: r.since } : null; },
            getMany(guildId, userIds) { return userIds.map((id) => [id, this.get(guildId, id)]).filter(([, v]) => v); },
        },

        counting: {
            getConfig: countConfig,
            setup(guildId, channelId) { ensure(guildId); db.prepare(`INSERT INTO counting_config (guild_id, channel_id) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, current = 0, last_user_id = NULL`).run(guildId, channelId); return countConfig(guildId); },
            disable(guildId) { db.prepare('UPDATE counting_config SET channel_id = NULL, current = 0, last_user_id = NULL WHERE guild_id = ?').run(guildId); },
            reset(guildId) { db.prepare('UPDATE counting_config SET current = 0, last_user_id = NULL WHERE guild_id = ?').run(guildId); },
            // The one place counting rules live. Returns { ok, number, record } or { ok:false, reason, at }.
            play(guildId, userId, number) {
                const c = countConfig(guildId); if (!c.channelId) return null;
                const bump = (col) => db.prepare(`INSERT INTO counting_stats (guild_id, user_id, ${col}) VALUES (?, ?, 1) ON CONFLICT (guild_id, user_id) DO UPDATE SET ${col} = ${col} + 1`).run(guildId, userId);
                if (number === c.current + 1 && userId !== c.lastUserId) {
                    const record = Math.max(c.record, number);
                    db.prepare('UPDATE counting_config SET current = ?, last_user_id = ?, record = ? WHERE guild_id = ?').run(number, userId, record, guildId); bump('correct');
                    return { ok: true, number, newRecord: number > c.record && number > 1 };
                }
                const reason = number === c.current + 1 ? 'twice' : 'wrong';
                db.prepare('UPDATE counting_config SET current = 0, last_user_id = NULL WHERE guild_id = ?').run(guildId); bump('ruined');
                return { ok: false, reason, at: c.current, expected: c.current + 1 };
            },
            top: (guildId, limit = 10) => db.prepare('SELECT user_id, correct, ruined FROM counting_stats WHERE guild_id = ? ORDER BY correct DESC LIMIT ?').all(guildId, limit).map((r) => ({ userId: r.user_id, correct: r.correct, ruined: r.ruined })),
            statsFor: (guildId, userId) => { const r = db.prepare('SELECT * FROM counting_stats WHERE guild_id = ? AND user_id = ?').get(guildId, userId); return { correct: r?.correct ?? 0, ruined: r?.ruined ?? 0 }; },
        },

        bump: {
            getConfig: (guildId) => bumpOf(db.prepare('SELECT * FROM bump_config WHERE guild_id = ?').get(guildId)),
            setup(guildId, { channelId, roleId = null }) { ensure(guildId); db.prepare(`INSERT INTO bump_config (guild_id, channel_id, role_id) VALUES (?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, role_id = excluded.role_id`).run(guildId, channelId, roleId); },
            disable(guildId) { db.prepare('UPDATE bump_config SET channel_id = NULL, next_at = NULL, reminded = 1 WHERE guild_id = ?').run(guildId); },
            // A bump happened: remind again after delayMs.
            start(guildId, delayMs) { const at = now() + delayMs; db.prepare('UPDATE bump_config SET next_at = ?, reminded = 0 WHERE guild_id = ? AND channel_id IS NOT NULL').run(at, guildId); return at; },
            due: (nowMs) => db.prepare('SELECT * FROM bump_config WHERE channel_id IS NOT NULL AND reminded = 0 AND next_at <= ?').all(nowMs).map((r) => ({ guildId: r.guild_id, ...bumpOf(r) })),
            claim: (guildId) => Number(db.prepare('UPDATE bump_config SET reminded = 1 WHERE guild_id = ? AND reminded = 0').run(guildId).changes) > 0,
        },

        scores: {
            record(guildId, userId, game, won) {
                if (!GAMES.includes(game)) throw new FunServiceError('Unknown game.'); ensure(guildId);
                db.prepare(`INSERT INTO game_scores (guild_id, user_id, game, wins, played) VALUES (?, ?, ?, ?, 1)
                    ON CONFLICT (guild_id, user_id, game) DO UPDATE SET wins = wins + excluded.wins, played = played + 1`).run(guildId, userId, game, won ? 1 : 0);
            },
            forUser: (guildId, userId) => db.prepare('SELECT game, wins, played FROM game_scores WHERE guild_id = ? AND user_id = ? ORDER BY wins DESC').all(guildId, userId).map((r) => ({ game: r.game, wins: r.wins, played: r.played })),
            top: (guildId, game, limit = 10) => db.prepare('SELECT user_id, wins, played FROM game_scores WHERE guild_id = ? AND game = ? ORDER BY wins DESC, played ASC LIMIT ?').all(guildId, game, limit).map((r) => ({ userId: r.user_id, wins: r.wins, played: r.played })),
        },
    };
}

module.exports = { createFunService, FunServiceError, GAMES };
