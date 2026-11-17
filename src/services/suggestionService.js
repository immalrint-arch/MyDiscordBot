const { isSnowflake } = require('../utils/snowflake');
const { MAX_SUGGESTION } = require('../utility/rules');

class SuggestionServiceError extends Error {}
const COOLDOWN_MS = 30 * 1000;

function createSuggestionService(db, { now = Date.now } = {}) {
    const ensure = (guildId) => {
        if (!isSnowflake(guildId)) throw new TypeError('Invalid guild ID.');
        db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
        db.prepare('INSERT OR IGNORE INTO suggestion_config (guild_id) VALUES (?)').run(guildId);
    };
    const toS = (r) => (r ? { id: r.id, guildId: r.guild_id, number: r.number, authorId: r.author_id, content: r.content, channelId: r.channel_id, messageId: r.message_id,
        status: r.status, handledBy: r.handled_by, note: r.note, createdAt: r.created_at } : null);
    return {
        getChannelId(guildId) { ensure(guildId); return db.prepare('SELECT channel_id FROM suggestion_config WHERE guild_id = ?').get(guildId).channel_id; },
        setChannel(guildId, channelId) { ensure(guildId); if (channelId !== null && !isSnowflake(channelId)) throw new TypeError('Invalid channel ID.'); db.prepare('UPDATE suggestion_config SET channel_id = ? WHERE guild_id = ?').run(channelId, guildId); },
        create(guildId, { authorId, content }) {
            ensure(guildId); if (!isSnowflake(authorId)) throw new TypeError('Invalid user ID.');
            const text = String(content ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
            if (!text) throw new SuggestionServiceError('Write your suggestion.');
            if (text.length > MAX_SUGGESTION) throw new SuggestionServiceError(`Keep it under ${MAX_SUGGESTION} characters.`);
            const last = db.prepare('SELECT MAX(created_at) AS t FROM suggestions WHERE guild_id = ? AND author_id = ?').get(guildId, authorId).t;
            if (last && now() - last < COOLDOWN_MS) throw new SuggestionServiceError(`Please wait ${Math.ceil((COOLDOWN_MS - (now() - last)) / 1000)} more second(s).`);
            return toS(db.prepare(`INSERT INTO suggestions (guild_id, number, author_id, content, created_at)
                VALUES (?, (SELECT COALESCE(MAX(number), 0) + 1 FROM suggestions WHERE guild_id = ?), ?, ?, ?) RETURNING *`).get(guildId, guildId, authorId, text, now()));
        },
        attachMessage: (guildId, number, channelId, messageId) => db.prepare('UPDATE suggestions SET channel_id = ?, message_id = ? WHERE guild_id = ? AND number = ?').run(channelId, messageId, guildId, number),
        discard: (guildId, number) => db.prepare('DELETE FROM suggestions WHERE guild_id = ? AND number = ? AND message_id IS NULL').run(guildId, number),
        getById: (id) => toS(db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id)),
        get: (guildId, number) => toS(db.prepare('SELECT * FROM suggestions WHERE guild_id = ? AND number = ?').get(guildId, number)),
        // vote: 1 = up, -1 = down. Same vote again removes it. Returns 'added' | 'changed' | 'removed' | 'closed'.
        vote(suggestionId, userId, vote) {
            const s = toS(db.prepare('SELECT * FROM suggestions WHERE id = ?').get(suggestionId));
            if (!s || s.status === 'approved' || s.status === 'denied') return 'closed';
            const cur = db.prepare('SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').get(suggestionId, userId);
            if (cur?.vote === vote) { db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').run(suggestionId, userId); return 'removed'; }
            db.prepare('INSERT INTO suggestion_votes (suggestion_id, user_id, vote) VALUES (?, ?, ?) ON CONFLICT (suggestion_id, user_id) DO UPDATE SET vote = excluded.vote').run(suggestionId, userId, vote);
            return cur ? 'changed' : 'added';
        },
        counts(suggestionId) {
            const r = db.prepare('SELECT COALESCE(SUM(vote = 1), 0) AS up, COALESCE(SUM(vote = -1), 0) AS down FROM suggestion_votes WHERE suggestion_id = ?').get(suggestionId);
            return { up: Number(r.up), down: Number(r.down) };
        },
        setStatus(guildId, number, status, handledBy, note = null) {
            if (!['considered', 'approved', 'denied'].includes(status)) throw new TypeError('Invalid status.');
            return toS(db.prepare("UPDATE suggestions SET status = ?, handled_by = ?, note = ? WHERE guild_id = ? AND number = ? AND status IN ('pending', 'considered') RETURNING *").get(status, handledBy, note, guildId, number));
        },
    };
}

module.exports = { createSuggestionService, SuggestionServiceError };
