const { isSnowflake } = require('../utils/snowflake');
const { cleanConfession, cooldownLeft, COOLDOWN_MIN, COOLDOWN_MAX, COOLDOWN_DEFAULT } = require('../confessions/confessionRules');

class ConfessionServiceError extends Error {} // safe to show to the member

function createConfessionService(db, { now = Date.now } = {}) {
    const assertId = (id, what = 'ID') => { if (!isSnowflake(id)) throw new TypeError(`Invalid ${what}.`); };
    const ensure = (guildId) => {
        assertId(guildId, 'guild ID');
        db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
        db.prepare('INSERT OR IGNORE INTO confession_config (guild_id) VALUES (?)').run(guildId);
    };
    // NOTE: the author is deliberately NOT part of what this returns.
    const toPublic = (r) => (r ? { number: r.number, content: r.content, channelId: r.channel_id, messageId: r.message_id, deleted: r.deleted === 1, createdAt: r.created_at } : null);
    const isBlocked = (guildId, userId) => Boolean(db.prepare('SELECT 1 FROM confession_blocks WHERE guild_id = ? AND user_id = ?').get(guildId, userId));

    return {
        COOLDOWN_DEFAULT,
        getConfig(guildId) {
            ensure(guildId);
            const r = db.prepare('SELECT channel_id, cooldown_seconds FROM confession_config WHERE guild_id = ?').get(guildId);
            return { channelId: r.channel_id, cooldownSeconds: r.cooldown_seconds };
        },
        setChannel(guildId, channelId) { ensure(guildId); if (channelId !== null) assertId(channelId, 'channel ID'); db.prepare('UPDATE confession_config SET channel_id = ? WHERE guild_id = ?').run(channelId, guildId); },
        setCooldown(guildId, seconds) {
            if (!Number.isInteger(seconds) || seconds < COOLDOWN_MIN || seconds > COOLDOWN_MAX) throw new ConfessionServiceError(`The cooldown must be between ${COOLDOWN_MIN} and ${COOLDOWN_MAX} seconds.`);
            ensure(guildId); db.prepare('UPDATE confession_config SET cooldown_seconds = ? WHERE guild_id = ?').run(seconds, guildId);
        },
        // Checks the rules WITHOUT saving (used by the button before the form opens).
        check(guildId, authorId) {
            ensure(guildId); assertId(authorId, 'user ID');
            if (isBlocked(guildId, authorId)) throw new ConfessionServiceError('You are not allowed to send confessions in this server.');
            const { cooldownSeconds } = this.getConfig(guildId);
            const last = db.prepare('SELECT MAX(created_at) AS t FROM confessions WHERE guild_id = ? AND author_id = ?').get(guildId, authorId).t;
            const left = cooldownLeft(last, cooldownSeconds, now());
            if (left > 0) throw new ConfessionServiceError(`Please wait ${left} more second${left === 1 ? '' : 's'} before confessing again.`);
        },
        create(guildId, authorId, text) {
            this.check(guildId, authorId);
            const cleaned = cleanConfession(text);
            if (!cleaned.ok) throw new ConfessionServiceError(cleaned.problem);
            return toPublic(db.prepare(`INSERT INTO confessions (guild_id, number, author_id, content, created_at)
                VALUES (?, (SELECT COALESCE(MAX(number), 0) + 1 FROM confessions WHERE guild_id = ?), ?, ?, ?) RETURNING *`)
                .get(guildId, guildId, authorId, cleaned.text, new Date(now()).toISOString()));
        },
        attachMessage(guildId, number, channelId, messageId) { db.prepare('UPDATE confessions SET channel_id = ?, message_id = ? WHERE guild_id = ? AND number = ?').run(channelId, messageId, guildId, number); },
        // A confession that could not be posted is removed, so it does not use up the member's cooldown.
        discard(guildId, number) { db.prepare('DELETE FROM confessions WHERE guild_id = ? AND number = ? AND message_id IS NULL').run(guildId, number); },
        get: (guildId, number) => toPublic(db.prepare('SELECT * FROM confessions WHERE guild_id = ? AND number = ?').get(guildId, number)),
        markDeleted: (guildId, number) => Number(db.prepare('UPDATE confessions SET deleted = 1 WHERE guild_id = ? AND number = ? AND deleted = 0').run(guildId, number).changes) > 0,
        // Blocks the AUTHOR of a confession without telling the moderator who it is.
        // Returns 'blocked', 'already' or 'missing'.
        blockAuthorOf(guildId, number) {
            const row = db.prepare('SELECT author_id FROM confessions WHERE guild_id = ? AND number = ?').get(guildId, number);
            if (!row) return 'missing';
            const changes = Number(db.prepare('INSERT OR IGNORE INTO confession_blocks (guild_id, user_id, from_number) VALUES (?, ?, ?)').run(guildId, row.author_id, number).changes);
            return changes > 0 ? 'blocked' : 'already';
        },
        // Unblocks whoever was blocked because of that confession number (listed by /confession blocked).
        unblockByNumber: (guildId, number) => Number(db.prepare('DELETE FROM confession_blocks WHERE guild_id = ? AND from_number = ?').run(guildId, number).changes) > 0,
        listBlockedNumbers: (guildId) => db.prepare('SELECT from_number FROM confession_blocks WHERE guild_id = ? ORDER BY from_number').all(guildId).map((r) => r.from_number),
    };
}

module.exports = { createConfessionService, ConfessionServiceError };
