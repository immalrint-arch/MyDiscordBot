const { isSnowflake } = require('../utils/snowflake');
const BANK = require('../qotd/bank');
const { MAX_QUESTIONS, validOffset, localClock } = require('../qotd/rules');

class QotdServiceError extends Error {} // safe to show

function createQotdService(db, { now = Date.now, random = Math.random } = {}) {
    const ensure = (g) => { if (!isSnowflake(g)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(g); };
    const toConfig = (r) => ({ enabled: Boolean(r?.enabled), channelId: r?.channel_id ?? null, roleId: r?.role_id ?? null, hour: r?.hour ?? 9, minute: r?.minute ?? 0, utcOffset: r?.utc_offset ?? 0, useThreads: r ? Boolean(r.use_threads) : true, useBuiltin: r ? Boolean(r.use_builtin) : true, lastDay: r?.last_day ?? null, counter: r?.counter ?? 0 });
    const cfgRow = (g) => db.prepare('SELECT * FROM qotd_config WHERE guild_id = ?').get(g);
    const toQuestion = (r) => ({ id: r.id, text: r.text, addedBy: r.added_by, addedAt: r.added_at, usedCount: r.used_count });

    return {
        getConfig: (g) => toConfig(cfgRow(g)),
        // patch: enabled, channelId, roleId, hour, minute, utcOffset, useThreads, useBuiltin
        configure(g, patch) {
            ensure(g);
            if (patch.utcOffset !== undefined && !validOffset(patch.utcOffset)) throw new QotdServiceError('utc_offset must be a whole number from -12 to 14.');
            if (patch.hour !== undefined && !(Number.isInteger(patch.hour) && patch.hour >= 0 && patch.hour <= 23)) throw new QotdServiceError('Invalid hour.');
            if (patch.minute !== undefined && !(Number.isInteger(patch.minute) && patch.minute >= 0 && patch.minute <= 59)) throw new QotdServiceError('Invalid minute.');
            for (const k of ['channelId', 'roleId']) if (patch[k] != null && !isSnowflake(patch[k])) throw new TypeError('Invalid ID.');
            const c = this.getConfig(g); const m = { ...c, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
            if (m.enabled && !m.channelId) throw new QotdServiceError('Run `/qotd setup` first (it needs a channel).');
            // if the time moves, the schedule is evaluated again from today: keep last_day as it is (a later time today still posts)
            db.prepare(`INSERT INTO qotd_config (guild_id, enabled, channel_id, role_id, hour, minute, utc_offset, use_threads, use_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (guild_id) DO UPDATE SET enabled = excluded.enabled, channel_id = excluded.channel_id, role_id = excluded.role_id, hour = excluded.hour, minute = excluded.minute, utc_offset = excluded.utc_offset, use_threads = excluded.use_threads, use_builtin = excluded.use_builtin`)
                .run(g, m.enabled ? 1 : 0, m.channelId, m.roleId, m.hour, m.minute, m.utcOffset, m.useThreads ? 1 : 0, m.useBuiltin ? 1 : 0);
            return this.getConfig(g);
        },
        enabledGuilds: () => db.prepare('SELECT * FROM qotd_config WHERE enabled = 1').all().map((r) => ({ guildId: r.guild_id, ...toConfig(r) })),
        addQuestion(g, text, by) {
            ensure(g); if (this.countQuestions(g) >= MAX_QUESTIONS) throw new QotdServiceError(`You can keep up to ${MAX_QUESTIONS} questions. Remove some first.`);
            if (db.prepare('SELECT 1 FROM qotd_questions WHERE guild_id = ? AND lower(text) = lower(?)').get(g, text)) throw new QotdServiceError('That question is already in the list.');
            return Number(db.prepare('INSERT INTO qotd_questions (guild_id, text, added_by, added_at) VALUES (?, ?, ?, ?)').run(g, text, by, now()).lastInsertRowid);
        },
        removeQuestion: (g, id) => Number(db.prepare('DELETE FROM qotd_questions WHERE guild_id = ? AND id = ?').run(g, id).changes) > 0,
        countQuestions: (g) => db.prepare('SELECT COUNT(*) AS n FROM qotd_questions WHERE guild_id = ?').get(g).n,
        listQuestions: (g, { limit = 10, offset = 0 } = {}) => db.prepare('SELECT * FROM qotd_questions WHERE guild_id = ? ORDER BY id LIMIT ? OFFSET ?').all(g, limit, offset).map(toQuestion),
        builtinSeen: (g) => db.prepare('SELECT COUNT(*) AS n FROM qotd_builtin_used WHERE guild_id = ?').get(g).n,
        // Chooses the next question without repeating until everything was used once:
        // 1) the server's own questions not used yet, 2) built-in ones not seen yet, 3) start a new round.
        // Returns { text, source, id } and marks it used. Throws if there is nothing to ask.
        pickQuestion(g) {
            ensure(g); const c = this.getConfig(g);
            const own = db.prepare('SELECT * FROM qotd_questions WHERE guild_id = ? ORDER BY used_count, id').all(g);
            const firstOwn = own[0];
            if (firstOwn && firstOwn.used_count === 0) return this._useOwn(firstOwn);
            if (c.useBuiltin) {
                const seen = new Set(db.prepare('SELECT idx FROM qotd_builtin_used WHERE guild_id = ?').all(g).map((r) => r.idx));
                let free = BANK.map((_, i) => i).filter((i) => !seen.has(i));
                if (!free.length && !firstOwn) { db.prepare('DELETE FROM qotd_builtin_used WHERE guild_id = ?').run(g); free = BANK.map((_, i) => i); }
                if (free.length) { const idx = free[Math.min(free.length - 1, Math.floor(random() * free.length))]; db.prepare('INSERT OR IGNORE INTO qotd_builtin_used (guild_id, idx) VALUES (?, ?)').run(g, idx); return { text: BANK[idx], source: 'builtin', id: null }; }
            }
            if (firstOwn) { // everything was used: the least used own question goes next (this starts a new round)
                if (c.useBuiltin) db.prepare('DELETE FROM qotd_builtin_used WHERE guild_id = ?').run(g);
                return this._useOwn(firstOwn);
            }
            throw new QotdServiceError('There are no questions to ask. Add some with `/qotd add`, or turn the built-in ones on.');
        },
        _useOwn(q) { db.prepare('UPDATE qotd_questions SET used_count = used_count + 1, last_used_at = ? WHERE id = ?').run(now(), q.id); return { text: q.text, source: 'own', id: q.id }; },
        // Exactly once per local day: only the first caller for a day gets true.
        claimDay(g, nowMs = now()) {
            const c = this.getConfig(g); const { day } = localClock(nowMs, c.utcOffset);
            return Number(db.prepare('UPDATE qotd_config SET last_day = ? WHERE guild_id = ? AND enabled = 1 AND (last_day IS NULL OR last_day < ?)').run(day, g, day).changes) > 0;
        },
        nextNumber(g) { db.prepare('UPDATE qotd_config SET counter = counter + 1 WHERE guild_id = ?').run(g); return cfgRow(g).counter; },
    };
}
module.exports = { createQotdService, QotdServiceError };
