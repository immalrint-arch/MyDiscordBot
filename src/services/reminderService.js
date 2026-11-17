const { isSnowflake } = require('../utils/snowflake');
const { MAX_REMINDERS_PER_USER, MIN_REMIND_MS, MAX_REMIND_MS, MAX_REMIND_TEXT } = require('../utility/rules');

class ReminderServiceError extends Error {}

function createReminderService(db, { now = Date.now } = {}) {
    const toReminder = (r) => (r ? { id: r.id, guildId: r.guild_id, userId: r.user_id, channelId: r.channel_id, text: r.text, dueAt: r.due_at, status: r.status } : null);
    return {
        create(guildId, { userId, channelId, text, delayMs }) {
            if (![guildId, userId, channelId].every(isSnowflake)) throw new TypeError('Invalid Discord ID.');
            const clean = String(text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
            if (!clean) throw new ReminderServiceError('Say what I should remind you about.');
            if (clean.length > MAX_REMIND_TEXT) throw new ReminderServiceError(`Keep it under ${MAX_REMIND_TEXT} characters.`);
            if (!Number.isFinite(delayMs) || delayMs < MIN_REMIND_MS) throw new ReminderServiceError('Pick a time at least 10 seconds from now.');
            if (delayMs > MAX_REMIND_MS) throw new ReminderServiceError('I can remind you up to 1 year ahead.');
            db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
            const pending = db.prepare("SELECT COUNT(*) AS n FROM reminders WHERE guild_id = ? AND user_id = ? AND status = 'pending'").get(guildId, userId).n;
            if (pending >= MAX_REMINDERS_PER_USER) throw new ReminderServiceError(`You already have ${MAX_REMINDERS_PER_USER} reminders. Cancel one first.`);
            const t = now();
            return toReminder(db.prepare('INSERT INTO reminders (guild_id, user_id, channel_id, text, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *').get(guildId, userId, channelId, clean, t + Math.floor(delayMs), t));
        },
        listForUser: (guildId, userId) => db.prepare("SELECT * FROM reminders WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY due_at").all(guildId, userId).map(toReminder),
        // Only the owner can cancel, and only while pending.
        cancel: (guildId, userId, id) => Number(db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND guild_id = ? AND user_id = ? AND status = 'pending'").run(id, guildId, userId).changes) > 0,
        due: (nowMs, limit = 50) => db.prepare("SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?").all(nowMs, limit).map(toReminder),
        // Marks it sent. Returns true only for the first caller (a reminder can never be delivered twice).
        claim: (id) => Number(db.prepare("UPDATE reminders SET status = 'sent' WHERE id = ? AND status = 'pending'").run(id).changes) > 0,
    };
}

module.exports = { createReminderService, ReminderServiceError };
