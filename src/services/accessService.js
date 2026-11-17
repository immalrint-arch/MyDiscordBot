const { isSnowflake } = require('../utils/snowflake');
const R = require('../access/rules');

class AccessServiceError extends Error {} // safe to show to a moderator

function createAccessService(db, { now = Date.now } = {}) {
    const ensure = (g) => { if (!isSnowflake(g)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(g); };
    const cache = new Map(); // guildId -> Map(command -> rules[])  (read on every command, so keep it in memory)
    const load = (g) => { let m = cache.get(g); if (!m) { m = new Map(); for (const r of db.prepare('SELECT command, kind, target_id FROM command_rules WHERE guild_id = ?').all(g)) { if (!m.has(r.command)) m.set(r.command, []); m.get(r.command).push({ kind: r.kind, targetId: r.target_id }); } cache.set(g, m); } return m; };
    const dirty = (g) => cache.delete(g);
    let blocked = null; const blockedSet = () => (blocked ??= new Set(db.prepare('SELECT user_id FROM global_blacklist').all().map((r) => r.user_id)));

    return {
        rules: {
            forCommand: (g, command) => load(g).get(command) ?? [],
            add(g, command, kind, targetId = '') {
                ensure(g); if (!R.KINDS.includes(kind)) throw new TypeError('Unknown rule kind.');
                if (R.PROTECTED.includes(command)) throw new AccessServiceError(`\`${command}\` can never be restricted, so nobody can lock themselves out.`);
                if (kind === 'disabled') targetId = ''; else if (!isSnowflake(targetId)) throw new TypeError('Invalid target ID.');
                if (db.prepare('SELECT COUNT(*) AS n FROM command_rules WHERE guild_id = ?').get(g).n >= R.MAX_RULES) throw new AccessServiceError(`You can have up to ${R.MAX_RULES} rules.`);
                // allow and deny for the same role/channel replace each other
                const opposite = { role_allow: 'role_deny', role_deny: 'role_allow', channel_allow: 'channel_deny', channel_deny: 'channel_allow' }[kind];
                if (opposite) db.prepare('DELETE FROM command_rules WHERE guild_id = ? AND command = ? AND kind = ? AND target_id = ?').run(g, command, opposite, targetId);
                db.prepare('INSERT OR IGNORE INTO command_rules (guild_id, command, kind, target_id) VALUES (?, ?, ?, ?)').run(g, command, kind, targetId); dirty(g);
            },
            remove(g, command, kinds, targetId = '') { const n = kinds.reduce((sum, k) => sum + Number(db.prepare('DELETE FROM command_rules WHERE guild_id = ? AND command = ? AND kind = ? AND target_id = ?').run(g, command, k, targetId).changes), 0); dirty(g); return n > 0; },
            clear(g, command) { const n = Number(db.prepare('DELETE FROM command_rules WHERE guild_id = ? AND command = ?').run(g, command).changes); dirty(g); return n; },
            list: (g) => [...load(g)].map(([command, rules]) => ({ command, rules })).sort((a, b) => a.command.localeCompare(b.command)),
            count: (g) => db.prepare('SELECT COUNT(*) AS n FROM command_rules WHERE guild_id = ?').get(g).n,
        },
        blacklist: {
            add(userId, reason, addedBy) { if (!isSnowflake(userId)) throw new TypeError('Invalid user ID.'); db.prepare('INSERT INTO global_blacklist (user_id, reason, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET reason = excluded.reason').run(userId, reason ?? null, addedBy, now()); blockedSet().add(userId); },
            remove(userId) { const ok = Number(db.prepare('DELETE FROM global_blacklist WHERE user_id = ?').run(userId).changes) > 0; blockedSet().delete(userId); return ok; },
            has: (userId) => blockedSet().has(userId),
            list: () => db.prepare('SELECT * FROM global_blacklist ORDER BY added_at DESC LIMIT 50').all().map((r) => ({ userId: r.user_id, reason: r.reason, addedBy: r.added_by, addedAt: r.added_at })),
            count: () => blockedSet().size,
        },
        config: {
            get: (key) => db.prepare('SELECT value FROM bot_config WHERE key = ?').get(key)?.value ?? null,
            set(key, value) { db.prepare('INSERT INTO bot_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, String(value)); },
            delete(key) { db.prepare('DELETE FROM bot_config WHERE key = ?').run(key); },
        },
    };
}
module.exports = { createAccessService, AccessServiceError };
