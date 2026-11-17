const { isSnowflake } = require('../utils/snowflake');
const R = require('../growth/rules');

class GrowthServiceError extends Error {} // safe to show to a moderator

function createGrowthService(db, { now = Date.now } = {}) {
    const ensure = (g) => { if (!isSnowflake(g)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(g); };
    const flag = (table) => ({
        isEnabled: (g) => Boolean(db.prepare(`SELECT enabled FROM ${table} WHERE guild_id = ?`).get(g)?.enabled),
        setEnabled(g, on) { ensure(g); db.prepare(`INSERT INTO ${table} (guild_id, enabled) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET enabled = excluded.enabled`).run(g, on ? 1 : 0); },
    });
    const sumRow = (g, where, arg) => db.prepare(`SELECT COUNT(*) AS joins, COALESCE(SUM(left_at IS NOT NULL), 0) AS left, COALESCE(SUM(fake = 1), 0) AS fake, COALESCE(SUM(left_at IS NULL AND fake = 0), 0) AS net FROM invite_joins WHERE guild_id = ? ${where}`).get(g, ...arg);
    const toCounter = (r) => ({ id: r.id, guildId: r.guild_id, channelId: r.channel_id, template: r.template, lastName: r.last_name, lastUpdate: r.last_update });

    return {
        invites: {
            ...flag('invite_config'),
            // One row per member: a person who leaves and rejoins is counted once (for their newest inviter).
            recordJoin(g, userId, { inviterId = null, code = null, fake = false }) {
                ensure(g); const inviter = inviterId && inviterId !== userId ? inviterId : null;
                db.prepare('INSERT INTO invite_joins (guild_id, user_id, inviter_id, code, joined_at, fake) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET inviter_id = excluded.inviter_id, code = excluded.code, joined_at = excluded.joined_at, left_at = NULL, fake = excluded.fake, joins = joins + 1')
                    .run(g, userId, inviter, code, now(), fake ? 1 : 0);
            },
            recordLeave(g, userId) { db.prepare('UPDATE invite_joins SET left_at = ? WHERE guild_id = ? AND user_id = ? AND left_at IS NULL').run(now(), g, userId); },
            inviterOf: (g, userId) => { const r = db.prepare('SELECT * FROM invite_joins WHERE guild_id = ? AND user_id = ?').get(g, userId); return r ? { inviterId: r.inviter_id, code: r.code, joinedAt: r.joined_at, leftAt: r.left_at, joins: r.joins } : null; },
            stats: (g, inviterId) => ({ ...sumRow(g, 'AND inviter_id = ?', [inviterId]) }),
            top(g, limit = 10) {
                return db.prepare('SELECT inviter_id AS inviterId, COUNT(*) AS joins, SUM(left_at IS NOT NULL) AS left, SUM(fake = 1) AS fake, SUM(left_at IS NULL AND fake = 0) AS net FROM invite_joins WHERE guild_id = ? AND inviter_id IS NOT NULL GROUP BY inviter_id ORDER BY net DESC, joins DESC, inviter_id LIMIT ?')
                    .all(g, limit).map((r) => ({ ...r }));
            },
            reset: (g) => Number(db.prepare('DELETE FROM invite_joins WHERE guild_id = ?').run(g).changes),
            total: (g) => db.prepare('SELECT COUNT(*) AS n FROM invite_joins WHERE guild_id = ?').get(g).n,
        },
        stickyRoles: {
            ...flag('stickyrole_config'),
            save(g, userId, roleIds) {
                ensure(g); if (!roleIds.length) { db.prepare('DELETE FROM stickyrole_saved WHERE guild_id = ? AND user_id = ?').run(g, userId); return; }
                db.prepare('INSERT INTO stickyrole_saved (guild_id, user_id, role_ids, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET role_ids = excluded.role_ids, saved_at = excluded.saved_at').run(g, userId, JSON.stringify(roleIds), now());
            },
            // Returns the saved role ids (and forgets them), or null.
            take(g, userId) {
                const r = db.prepare('SELECT * FROM stickyrole_saved WHERE guild_id = ? AND user_id = ?').get(g, userId); if (!r) return null;
                db.prepare('DELETE FROM stickyrole_saved WHERE guild_id = ? AND user_id = ?').run(g, userId);
                if (now() - r.saved_at > R.SAVED_ROLES_MAX_AGE_MS) return null;
                try { const ids = JSON.parse(r.role_ids); return Array.isArray(ids) ? ids.filter(isSnowflake) : null; } catch { return null; }
            },
            forget: (g, userId) => Number(db.prepare('DELETE FROM stickyrole_saved WHERE guild_id = ? AND user_id = ?').run(g, userId).changes) > 0,
            count: (g) => db.prepare('SELECT COUNT(*) AS n FROM stickyrole_saved WHERE guild_id = ?').get(g).n,
            purgeOld: () => Number(db.prepare('DELETE FROM stickyrole_saved WHERE saved_at < ?').run(now() - R.SAVED_ROLES_MAX_AGE_MS).changes),
        },
        counters: {
            add(g, { channelId, template }) {
                ensure(g); if (!isSnowflake(channelId)) throw new TypeError('Invalid channel ID.');
                const v = R.validTemplate(template); if (v.problem) throw new GrowthServiceError(v.problem);
                const exists = db.prepare('SELECT 1 FROM member_counters WHERE guild_id = ? AND channel_id = ?').get(g, channelId);
                if (!exists && db.prepare('SELECT COUNT(*) AS n FROM member_counters WHERE guild_id = ?').get(g).n >= R.MAX_COUNTERS) throw new GrowthServiceError(`You can have up to ${R.MAX_COUNTERS} counter channels. Remove one first.`);
                db.prepare('INSERT INTO member_counters (guild_id, channel_id, template) VALUES (?, ?, ?) ON CONFLICT (guild_id, channel_id) DO UPDATE SET template = excluded.template, last_name = NULL, last_update = 0').run(g, channelId, v.template);
                return toCounter(db.prepare('SELECT * FROM member_counters WHERE guild_id = ? AND channel_id = ?').get(g, channelId));
            },
            remove: (g, channelId) => Number(db.prepare('DELETE FROM member_counters WHERE guild_id = ? AND channel_id = ?').run(g, channelId).changes) > 0,
            list: (g) => db.prepare('SELECT * FROM member_counters WHERE guild_id = ? ORDER BY id').all(g).map(toCounter),
            all: () => db.prepare('SELECT * FROM member_counters ORDER BY id').all().map(toCounter),
            markUpdated(id, name, t = now()) { db.prepare('UPDATE member_counters SET last_name = ?, last_update = ? WHERE id = ?').run(name, t, id); },
            removeById(id) { db.prepare('DELETE FROM member_counters WHERE id = ?').run(id); },
            count: (g) => db.prepare('SELECT COUNT(*) AS n FROM member_counters WHERE guild_id = ?').get(g).n,
        },
    };
}
module.exports = { createGrowthService, GrowthServiceError };
