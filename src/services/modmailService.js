const { isSnowflake } = require('../utils/snowflake');

class ModmailServiceError extends Error {} // safe to show

function createModmailService(db, { now = Date.now } = {}) {
    const ensure = (g) => { if (!isSnowflake(g)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(g); };
    const toThread = (r) => (r ? { id: r.id, guildId: r.guild_id, userId: r.user_id, channelId: r.channel_id, status: r.status, openedAt: r.opened_at, closedAt: r.closed_at, closedBy: r.closed_by, closeReason: r.close_reason } : null);
    let openChannels = null; // channel ids of open conversations: checked for every message in every server, so keep it in memory
    const channels = () => (openChannels ??= new Set(db.prepare("SELECT channel_id FROM modmail_threads WHERE status = 'open'").all().map((r) => r.channel_id)));
    const cfgRow = (g) => db.prepare('SELECT * FROM modmail_config WHERE guild_id = ?').get(g);

    return {
        getConfig(g) { const r = cfgRow(g); return { enabled: Boolean(r?.enabled), categoryId: r?.category_id ?? null, staffRoleId: r?.staff_role_id ?? null, logChannelId: r?.log_channel_id ?? null, anonymous: Boolean(r?.anonymous) }; },
        setup(g, { categoryId, staffRoleId, logChannelId, anonymous = false }) {
            ensure(g); for (const [v, w] of [[categoryId, 'category'], [staffRoleId, 'staff role'], [logChannelId, 'log channel']]) if (!isSnowflake(v)) throw new TypeError(`Invalid ${w}.`);
            db.prepare('INSERT INTO modmail_config (guild_id, enabled, category_id, staff_role_id, log_channel_id, anonymous) VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET enabled = 1, category_id = excluded.category_id, staff_role_id = excluded.staff_role_id, log_channel_id = excluded.log_channel_id, anonymous = excluded.anonymous')
                .run(g, categoryId, staffRoleId, logChannelId, anonymous ? 1 : 0);
        },
        setEnabled(g, on) {
            const c = this.getConfig(g); if (on && (!c.categoryId || !c.staffRoleId || !c.logChannelId)) throw new ModmailServiceError('Run `/modmail setup` first.');
            ensure(g); db.prepare('INSERT INTO modmail_config (guild_id, enabled) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET enabled = excluded.enabled').run(g, on ? 1 : 0);
        },
        // The database allows one open conversation per member and server; a second tries throws.
        openThread(g, userId, channelId) {
            ensure(g); if (!isSnowflake(userId) || !isSnowflake(channelId)) throw new TypeError('Invalid ID.');
            try { const id = Number(db.prepare('INSERT INTO modmail_threads (guild_id, user_id, channel_id, opened_at) VALUES (?, ?, ?, ?)').run(g, userId, channelId, now()).lastInsertRowid); channels().add(channelId); return id; }
            catch (error) { if (/UNIQUE/i.test(error.message)) throw new ModmailServiceError('That member already has an open conversation.'); throw error; }
        },
        get: (id) => toThread(db.prepare('SELECT * FROM modmail_threads WHERE id = ?').get(id)),
        isThreadChannel: (channelId) => channels().has(channelId),
        byChannel: (channelId) => toThread(db.prepare("SELECT * FROM modmail_threads WHERE channel_id = ? AND status = 'open'").get(channelId)),
        openOf: (g, userId) => toThread(db.prepare("SELECT * FROM modmail_threads WHERE guild_id = ? AND user_id = ? AND status = 'open'").get(g, userId)),
        openThreadsOfUser: (userId) => db.prepare("SELECT * FROM modmail_threads WHERE user_id = ? AND status = 'open' ORDER BY id DESC").all(userId).map(toThread),
        // Exactly once: only the first call for an open conversation returns true.
        close(id, { closedBy, reason = null }) {
            const t = toThread(db.prepare('SELECT * FROM modmail_threads WHERE id = ?').get(id)); if (!t) return false;
            const ok = Number(db.prepare("UPDATE modmail_threads SET status = 'closed', closed_at = ?, closed_by = ?, close_reason = ? WHERE id = ? AND status = 'open'").run(now(), closedBy, reason ? String(reason).slice(0, 300) : null, id).changes) > 0;
            if (ok) channels().delete(t.channelId); return ok;
        },
        block(g, userId, reason, by) { ensure(g); if (!isSnowflake(userId)) throw new TypeError('Invalid user.'); db.prepare('INSERT INTO modmail_blocks (guild_id, user_id, reason, blocked_by, blocked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET reason = excluded.reason').run(g, userId, reason ? String(reason).slice(0, 200) : null, by, now()); },
        unblock: (g, userId) => Number(db.prepare('DELETE FROM modmail_blocks WHERE guild_id = ? AND user_id = ?').run(g, userId).changes) > 0,
        isBlocked: (g, userId) => Boolean(db.prepare('SELECT 1 FROM modmail_blocks WHERE guild_id = ? AND user_id = ?').get(g, userId)),
        listBlocked: (g) => db.prepare('SELECT * FROM modmail_blocks WHERE guild_id = ? ORDER BY blocked_at DESC LIMIT 25').all(g).map((r) => ({ userId: r.user_id, reason: r.reason, blockedBy: r.blocked_by, blockedAt: r.blocked_at })),
        countOfUser: (g, userId) => db.prepare('SELECT COUNT(*) AS n FROM modmail_threads WHERE guild_id = ? AND user_id = ?').get(g, userId).n,
        countOpen: (g) => db.prepare("SELECT COUNT(*) AS n FROM modmail_threads WHERE guild_id = ? AND status = 'open'").get(g).n,
    };
}
module.exports = { createModmailService, ModmailServiceError };
