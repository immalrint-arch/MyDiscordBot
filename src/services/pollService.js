const { isSnowflake } = require('../utils/snowflake');
const { parseOptions, tally, MAX_QUESTION } = require('../utility/rules');

class PollServiceError extends Error {}
const MAX_OPEN = 10;
const MIN_MS = 60 * 1000, MAX_MS = 30 * 864e5;

function createPollService(db, { now = Date.now } = {}) {
    const toPoll = (r) => (r ? { id: r.id, guildId: r.guild_id, number: r.poll_number, channelId: r.channel_id, messageId: r.message_id, creatorId: r.creator_id, question: r.question,
        options: JSON.parse(r.options), multiple: r.multiple === 1, status: r.status, endsAt: r.ends_at, createdAt: r.created_at } : null);
    return {
        MAX_OPEN,
        create(guildId, { channelId, creatorId, question, optionsText, multiple = false, durationMs = null }) {
            if (![guildId, channelId, creatorId].every(isSnowflake)) throw new TypeError('Invalid Discord ID.');
            const q = String(question ?? '').replace(/\s+/g, ' ').trim();
            if (!q) throw new PollServiceError('Write a question.');
            if (q.length > MAX_QUESTION) throw new PollServiceError(`The question can be at most ${MAX_QUESTION} characters.`);
            const parsed = parseOptions(optionsText); if (!parsed.ok) throw new PollServiceError(parsed.problem);
            if (durationMs !== null && (durationMs < MIN_MS || durationMs > MAX_MS)) throw new PollServiceError('A poll must last between 1 minute and 30 days.');
            db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
            const open = db.prepare("SELECT COUNT(*) AS n FROM polls WHERE guild_id = ? AND status = 'open'").get(guildId).n;
            if (open >= MAX_OPEN) throw new PollServiceError(`There are already ${MAX_OPEN} open polls. End one first.`);
            const t = now();
            return toPoll(db.prepare(`INSERT INTO polls (guild_id, poll_number, channel_id, creator_id, question, options, multiple, ends_at, created_at)
                VALUES (?, (SELECT COALESCE(MAX(poll_number), 0) + 1 FROM polls WHERE guild_id = ?), ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
                .get(guildId, guildId, channelId, creatorId, q, JSON.stringify(parsed.options), multiple ? 1 : 0, durationMs ? t + durationMs : null, t));
        },
        attachMessage: (guildId, number, messageId) => db.prepare('UPDATE polls SET message_id = ? WHERE guild_id = ? AND poll_number = ?').run(messageId, guildId, number),
        discard: (guildId, number) => db.prepare('DELETE FROM polls WHERE guild_id = ? AND poll_number = ? AND message_id IS NULL').run(guildId, number),
        get: (guildId, number) => toPoll(db.prepare('SELECT * FROM polls WHERE guild_id = ? AND poll_number = ?').get(guildId, number)),
        getById: (id) => toPoll(db.prepare('SELECT * FROM polls WHERE id = ?').get(id)),
        // A vote click. Single choice: choosing again replaces, choosing the same removes. Multiple: toggles that option.
        // Returns { changed: 'added'|'removed'|'closed'|'invalid' }.
        vote(pollId, userId, optionIndex) {
            const poll = this.getById(pollId);
            if (!poll || poll.status !== 'open' || (poll.endsAt && poll.endsAt <= now())) return { changed: 'closed' };
            if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) return { changed: 'invalid' };
            const has = db.prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?').get(pollId, userId, optionIndex);
            if (has) { db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?').run(pollId, userId, optionIndex); return { changed: 'removed' }; }
            if (!poll.multiple) db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(pollId, userId);
            db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)').run(pollId, userId, optionIndex);
            return { changed: 'added' };
        },
        results(pollId) {
            const poll = this.getById(pollId);
            const votes = db.prepare('SELECT option_index FROM poll_votes WHERE poll_id = ?').all(pollId);
            const voters = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id = ?').get(pollId).n;
            return { poll, rows: tally(poll.options.length, votes), voters };
        },
        // Ends an OPEN poll. Only the first caller gets it back (exactly-once).
        end: (guildId, number) => toPoll(db.prepare("UPDATE polls SET status = 'ended' WHERE guild_id = ? AND poll_number = ? AND status = 'open' RETURNING *").get(guildId, number)),
        due: (nowMs) => db.prepare("SELECT * FROM polls WHERE status = 'open' AND ends_at IS NOT NULL AND ends_at <= ?").all(nowMs).map(toPoll),
        listOpen: (guildId) => db.prepare("SELECT * FROM polls WHERE guild_id = ? AND status = 'open' ORDER BY poll_number").all(guildId).map(toPoll),
    };
}

module.exports = { createPollService, PollServiceError };
