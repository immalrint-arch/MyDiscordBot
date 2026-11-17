const { isSnowflake } = require('../utils/snowflake');

function createVoiceTimeService(db) {
    const ensure = (g) => { if (!isSnowflake(g)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(g); };
    return {
        isEnabled: (g) => Boolean(db.prepare('SELECT enabled FROM voice_time_config WHERE guild_id = ?').get(g)?.enabled),
        setEnabled(g, on) { ensure(g); db.prepare('INSERT INTO voice_time_config (guild_id, enabled) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET enabled = excluded.enabled').run(g, on ? 1 : 0); },
        enabledGuilds: () => db.prepare('SELECT guild_id FROM voice_time_config WHERE enabled = 1').all().map((r) => r.guild_id),
        // One minute for each person (called once a minute). Everything or nothing is saved.
        addMinute(g, userIds, day) {
            if (!userIds.length) return 0; ensure(g);
            db.exec('BEGIN');
            try {
                for (const u of userIds) {
                    if (!isSnowflake(u)) continue;
                    db.prepare('INSERT INTO voice_time_totals (guild_id, user_id, minutes) VALUES (?, ?, 1) ON CONFLICT (guild_id, user_id) DO UPDATE SET minutes = minutes + 1').run(g, u);
                    db.prepare('INSERT INTO voice_time_daily (guild_id, user_id, day, minutes) VALUES (?, ?, ?, 1) ON CONFLICT (guild_id, user_id, day) DO UPDATE SET minutes = minutes + 1').run(g, u, day);
                }
                db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
            return userIds.length;
        },
        total: (g, u) => db.prepare('SELECT minutes FROM voice_time_totals WHERE guild_id = ? AND user_id = ?').get(g, u)?.minutes ?? 0,
        between: (g, u, startDay, endDay) => db.prepare('SELECT COALESCE(SUM(minutes), 0) AS m FROM voice_time_daily WHERE guild_id = ? AND user_id = ? AND day BETWEEN ? AND ?').get(g, u, startDay, endDay).m,
        // 1 = most time. null when the person has none.
        rank(g, u) { const me = this.total(g, u); return me > 0 ? db.prepare('SELECT COUNT(*) AS n FROM voice_time_totals WHERE guild_id = ? AND minutes > ?').get(g, me).n + 1 : null; },
        top(g, { startDay = null, endDay = null, limit = 10 } = {}) {
            const rows = startDay === null
                ? db.prepare('SELECT user_id, minutes FROM voice_time_totals WHERE guild_id = ? AND minutes > 0 ORDER BY minutes DESC, user_id LIMIT ?').all(g, limit)
                : db.prepare('SELECT user_id, SUM(minutes) AS minutes FROM voice_time_daily WHERE guild_id = ? AND day BETWEEN ? AND ? GROUP BY user_id HAVING SUM(minutes) > 0 ORDER BY minutes DESC, user_id LIMIT ?').all(g, startDay, endDay, limit);
            return rows.map((r) => ({ userId: r.user_id, minutes: r.minutes }));
        },
        resetUser(g, u) { const a = db.prepare('DELETE FROM voice_time_totals WHERE guild_id = ? AND user_id = ?').run(g, u); db.prepare('DELETE FROM voice_time_daily WHERE guild_id = ? AND user_id = ?').run(g, u); return Number(a.changes) > 0; },
        purgeOldDaily: (beforeDay) => Number(db.prepare('DELETE FROM voice_time_daily WHERE day < ?').run(beforeDay).changes),
        countPeople: (g) => db.prepare('SELECT COUNT(*) AS n FROM voice_time_totals WHERE guild_id = ? AND minutes > 0').get(g).n,
    };
}
module.exports = { createVoiceTimeService };
