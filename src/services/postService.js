const { isSnowflake } = require('../utils/snowflake');
const R = require('../posts/rules');

class PostServiceError extends Error {} // safe to show to a moderator

function createPostService(db, { now = Date.now } = {}) {
    const ensure = (g) => { if (!isSnowflake(g)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(g); };
    const parse = (j) => { try { return j ? JSON.parse(j) : null; } catch { return null; } };
    const toPost = (r) => (r ? { id: r.id, guildId: r.guild_id, channelId: r.channel_id, content: r.content, embed: parse(r.embed_json), pingRoleId: r.ping_role_id, intervalSeconds: r.interval_seconds, maxRuns: r.max_runs, runs: r.runs, nextRunAt: r.next_run_at, enabled: !!r.enabled, failCount: r.fail_count, createdBy: r.created_by } : null);
    const toSticky = (r) => (r ? { guildId: r.guild_id, channelId: r.channel_id, content: r.content, embed: parse(r.embed_json), lastMessageId: r.last_message_id, createdBy: r.created_by } : null);
    const stickyChannels = new Map(); // guildId -> Set of channel ids (so normal chat does not touch the database)
    const stickySet = (g) => { let s = stickyChannels.get(g); if (!s) { s = new Set(db.prepare('SELECT channel_id FROM sticky_messages WHERE guild_id = ?').all(g).map((r) => r.channel_id)); stickyChannels.set(g, s); } return s; };
    const needBody = (content, embed) => { if (!content && !embed) throw new PostServiceError('There is nothing to post. Add some text or an embed.'); };

    return {
        scheduled: {
            add(guildId, { channelId, content = null, embed = null, pingRoleId = null, runAt, intervalSeconds = null, maxRuns = null, createdBy }) {
                ensure(guildId); needBody(content, embed);
                if (!isSnowflake(channelId)) throw new TypeError('Invalid channel ID.'); if (pingRoleId !== null && !isSnowflake(pingRoleId)) throw new TypeError('Invalid role ID.');
                if (intervalSeconds !== null && (!Number.isInteger(intervalSeconds) || intervalSeconds < R.MIN_REPEAT_S || intervalSeconds > R.MAX_REPEAT_S)) throw new PostServiceError('Repeating posts need 10 minutes to 30 days between them.');
                if (maxRuns !== null && (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > R.MAX_RUNS)) throw new PostServiceError(`The number of times must be 1 to ${R.MAX_RUNS}.`);
                if (db.prepare('SELECT COUNT(*) AS n FROM scheduled_posts WHERE guild_id = ?').get(guildId).n >= R.MAX_SCHEDULED) throw new PostServiceError(`You can have up to ${R.MAX_SCHEDULED} scheduled posts. Remove one first.`);
                return Number(db.prepare('INSERT INTO scheduled_posts (guild_id, channel_id, content, embed_json, ping_role_id, interval_seconds, max_runs, next_run_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .run(guildId, channelId, content, embed ? JSON.stringify(embed) : null, pingRoleId, intervalSeconds, maxRuns, runAt, createdBy, now()).lastInsertRowid);
            },
            get: (guildId, id) => toPost(db.prepare('SELECT * FROM scheduled_posts WHERE guild_id = ? AND id = ?').get(guildId, id)),
            list: (guildId) => db.prepare('SELECT * FROM scheduled_posts WHERE guild_id = ? ORDER BY next_run_at').all(guildId).map(toPost),
            remove: (guildId, id) => Number(db.prepare('DELETE FROM scheduled_posts WHERE guild_id = ? AND id = ?').run(guildId, id).changes) > 0,
            setEnabled(guildId, id, enabled) {
                const p = this.get(guildId, id); if (!p) return false;
                // turning a repeating post back on: move it to its next future slot instead of firing all missed ones
                const next = enabled && p.nextRunAt <= now() ? (p.intervalSeconds ? R.nextSlot(p.nextRunAt, p.intervalSeconds * 1000, now()) : now() + 60000) : p.nextRunAt;
                return Number(db.prepare('UPDATE scheduled_posts SET enabled = ?, fail_count = 0, next_run_at = ? WHERE guild_id = ? AND id = ?').run(enabled ? 1 : 0, next, guildId, id).changes) > 0;
            },
            due: (t) => db.prepare('SELECT * FROM scheduled_posts WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at LIMIT 50').all(t).map(toPost),
            // Exactly-once: only the caller whose expected time still matches gets true. Repeats move on; one-time and finished posts are deleted.
            claim(post, t = now()) {
                const finished = !post.intervalSeconds || (post.maxRuns !== null && post.runs + 1 >= post.maxRuns);
                if (finished) return Number(db.prepare('DELETE FROM scheduled_posts WHERE id = ? AND next_run_at = ? AND enabled = 1').run(post.id, post.nextRunAt).changes) > 0;
                const next = R.nextSlot(post.nextRunAt, post.intervalSeconds * 1000, t);
                return Number(db.prepare('UPDATE scheduled_posts SET runs = runs + 1, next_run_at = ? WHERE id = ? AND next_run_at = ? AND enabled = 1').run(next, post.id, post.nextRunAt).changes) > 0;
            },
            // Returns true when the post was switched off because it keeps failing.
            fail(id) { db.prepare('UPDATE scheduled_posts SET fail_count = fail_count + 1 WHERE id = ?').run(id); return Number(db.prepare('UPDATE scheduled_posts SET enabled = 0 WHERE id = ? AND fail_count >= 3').run(id).changes) > 0; },
            succeed(id) { db.prepare('UPDATE scheduled_posts SET fail_count = 0 WHERE id = ?').run(id); },
            count: (guildId) => db.prepare('SELECT COUNT(*) AS n FROM scheduled_posts WHERE guild_id = ? AND enabled = 1').get(guildId).n,
        },
        sticky: {
            set(guildId, { channelId, content = null, embed = null, createdBy }) {
                ensure(guildId); needBody(content, embed); if (!isSnowflake(channelId)) throw new TypeError('Invalid channel ID.');
                const exists = db.prepare('SELECT 1 FROM sticky_messages WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId);
                if (!exists && db.prepare('SELECT COUNT(*) AS n FROM sticky_messages WHERE guild_id = ?').get(guildId).n >= R.MAX_STICKY) throw new PostServiceError(`You can have up to ${R.MAX_STICKY} sticky messages. Remove one first.`);
                db.prepare('INSERT INTO sticky_messages (guild_id, channel_id, content, embed_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (guild_id, channel_id) DO UPDATE SET content = excluded.content, embed_json = excluded.embed_json')
                    .run(guildId, channelId, content, embed ? JSON.stringify(embed) : null, createdBy, now());
                stickySet(guildId).add(channelId);
            },
            get: (guildId, channelId) => toSticky(db.prepare('SELECT * FROM sticky_messages WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId)),
            has: (guildId, channelId) => stickySet(guildId).has(channelId),
            list: (guildId) => db.prepare('SELECT * FROM sticky_messages WHERE guild_id = ? ORDER BY channel_id').all(guildId).map(toSticky),
            remove(guildId, channelId) { const ok = Number(db.prepare('DELETE FROM sticky_messages WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId).changes) > 0; stickySet(guildId).delete(channelId); return ok; },
            setLastMessage(guildId, channelId, messageId) { db.prepare('UPDATE sticky_messages SET last_message_id = ? WHERE guild_id = ? AND channel_id = ?').run(messageId, guildId, channelId); },
            count: (guildId) => db.prepare('SELECT COUNT(*) AS n FROM sticky_messages WHERE guild_id = ?').get(guildId).n,
        },
    };
}
module.exports = { createPostService, PostServiceError };
