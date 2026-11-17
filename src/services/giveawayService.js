const { isSnowflake } = require('../utils/snowflake');

class GiveawayServiceError extends Error {} // safe to show to a moderator

const MAX_ACTIVE_GIVEAWAYS = 25;
const MAX_ACTIVE_EVENTS = 25;

const assertId = (id, what) => { if (!isSnowflake(id)) throw new TypeError(`Invalid ${what}.`); };
const toGiveaway = (r) => (!r ? null : {
    id: r.id, guildId: r.guild_id, channelId: r.channel_id, messageId: r.message_id, hostId: r.host_id, prize: r.prize,
    description: r.description, winners: r.winners, endsAt: r.ends_at, status: r.status, requiredRoleId: r.required_role_id,
    bypassRoleId: r.bypass_role_id, minLevel: r.min_level, minDays: r.min_days, pingRoleId: r.ping_role_id,
    winnerIds: JSON.parse(r.winner_ids), createdAt: r.created_at, endedAt: r.ended_at,
});
const toEvent = (r) => (!r ? null : {
    id: r.id, guildId: r.guild_id, channelId: r.channel_id, messageId: r.message_id, hostId: r.host_id, title: r.title,
    description: r.description, location: r.location, startsAt: r.starts_at, pingRoleId: r.ping_role_id, status: r.status, reminded: r.reminded === 1,
});

function createGiveawayService(db, { now = Date.now } = {}) {
    const ensureGuild = (guildId) => { assertId(guildId, 'guild ID'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId); };
    const changed = (r) => Number(r.changes) > 0;

    const giveaways = {
        create(guildId, data) {
            ensureGuild(guildId);
            for (const [k, v] of Object.entries({ channel: data.channelId, host: data.hostId })) assertId(v, k);
            for (const k of ['requiredRoleId', 'bypassRoleId', 'pingRoleId']) if (data[k] != null) assertId(data[k], k);
            const active = db.prepare("SELECT COUNT(*) AS n FROM giveaways WHERE guild_id = ? AND status = 'active'").get(guildId).n;
            if (active >= MAX_ACTIVE_GIVEAWAYS) throw new GiveawayServiceError(`You can have at most ${MAX_ACTIVE_GIVEAWAYS} running giveaways.`);
            const prize = String(data.prize ?? '').trim();
            if (!prize || prize.length > 200) throw new GiveawayServiceError('The prize must be 1 to 200 characters.');
            if (!Number.isInteger(data.winners) || data.winners < 1 || data.winners > 20) throw new GiveawayServiceError('Winners must be 1 to 20.');
            const r = db.prepare(`INSERT INTO giveaways (guild_id, channel_id, host_id, prize, description, winners, ends_at, required_role_id, bypass_role_id, min_level, min_days, ping_role_id, created_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(guildId, data.channelId, data.hostId, prize, data.description ?? null, data.winners, data.endsAt, data.requiredRoleId ?? null, data.bypassRoleId ?? null,
                    data.minLevel ?? 0, data.minDays ?? 0, data.pingRoleId ?? null, now());
            return this.get(Number(r.lastInsertRowid));
        },
        get: (id) => toGiveaway(db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id)),
        getForGuild: (guildId, id) => toGiveaway(db.prepare('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?').get(id, guildId)),
        setMessage: (id, messageId) => db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, id),
        delete: (id) => db.prepare('DELETE FROM giveaways WHERE id = ?').run(id),
        listActive: (guildId) => db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND status = 'active' ORDER BY ends_at").all(guildId).map(toGiveaway),
        listRecent: (guildId, limit = 10) => db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND status != 'active' ORDER BY id DESC LIMIT ?").all(guildId, limit).map(toGiveaway),
        due: (at = now()) => db.prepare("SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= ? ORDER BY ends_at").all(at).map(toGiveaway),
        // Moves active -> ended exactly once, even if two things try at the same moment. Returns true for the one that won.
        markEnded: (id) => changed(db.prepare("UPDATE giveaways SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'active'").run(now(), id)),
        markCancelled: (id) => changed(db.prepare("UPDATE giveaways SET status = 'cancelled', ended_at = ? WHERE id = ? AND status = 'active'").run(now(), id)),
        setEndsAt(id, endsAt) { return changed(db.prepare("UPDATE giveaways SET ends_at = ? WHERE id = ? AND status = 'active'").run(endsAt, id)); },
        setWinners: (id, ids) => db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify(ids), id),
        // entries
        addEntry: (id, userId) => changed(db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(id, userId)),
        removeEntry: (id, userId) => changed(db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(id, userId)),
        hasEntry: (id, userId) => Boolean(db.prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').get(id, userId)),
        countEntries: (id) => db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?').get(id).n,
        entries: (id) => db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(id).map((r) => r.user_id),
    };

    const events = {
        create(guildId, data) {
            ensureGuild(guildId); assertId(data.channelId, 'channel'); assertId(data.hostId, 'host');
            if (data.pingRoleId != null) assertId(data.pingRoleId, 'role');
            const active = db.prepare("SELECT COUNT(*) AS n FROM events WHERE guild_id = ? AND status = 'scheduled'").get(guildId).n;
            if (active >= MAX_ACTIVE_EVENTS) throw new GiveawayServiceError(`You can have at most ${MAX_ACTIVE_EVENTS} upcoming events.`);
            const title = String(data.title ?? '').trim();
            if (!title || title.length > 100) throw new GiveawayServiceError('The title must be 1 to 100 characters.');
            if (!Number.isFinite(data.startsAt) || data.startsAt <= now()) throw new GiveawayServiceError('The start time must be in the future.');
            const r = db.prepare('INSERT INTO events (guild_id, channel_id, host_id, title, description, location, starts_at, ping_role_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(guildId, data.channelId, data.hostId, title, data.description ?? null, data.location ?? null, data.startsAt, data.pingRoleId ?? null, now());
            return this.get(Number(r.lastInsertRowid));
        },
        get: (id) => toEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(id)),
        getForGuild: (guildId, id) => toEvent(db.prepare('SELECT * FROM events WHERE id = ? AND guild_id = ?').get(id, guildId)),
        setMessage: (id, messageId) => db.prepare('UPDATE events SET message_id = ? WHERE id = ?').run(messageId, id),
        listUpcoming: (guildId) => db.prepare("SELECT * FROM events WHERE guild_id = ? AND status = 'scheduled' ORDER BY starts_at").all(guildId).map(toEvent),
        dueReminders: (leadMs, at = now()) => db.prepare("SELECT * FROM events WHERE status = 'scheduled' AND reminded = 0 AND starts_at - ? <= ?").all(leadMs, at).map(toEvent),
        dueStarts: (at = now()) => db.prepare("SELECT * FROM events WHERE status = 'scheduled' AND starts_at <= ?").all(at).map(toEvent),
        markReminded: (id) => changed(db.prepare('UPDATE events SET reminded = 1 WHERE id = ? AND reminded = 0').run(id)),
        markStarted: (id) => changed(db.prepare("UPDATE events SET status = 'started' WHERE id = ? AND status = 'scheduled'").run(id)),
        markCancelled: (id) => changed(db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'").run(id)),
        rsvp(id, userId, answer) {
            if (!['going', 'maybe'].includes(answer)) throw new TypeError('Invalid answer.');
            db.prepare('INSERT INTO event_rsvps (event_id, user_id, answer) VALUES (?, ?, ?) ON CONFLICT (event_id, user_id) DO UPDATE SET answer = excluded.answer').run(id, userId, answer);
        },
        removeRsvp: (id, userId) => changed(db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(id, userId)),
        rsvps: (id, answer = null) => db.prepare(`SELECT user_id, answer FROM event_rsvps WHERE event_id = ? ${answer ? 'AND answer = ?' : ''} ORDER BY rowid`).all(...(answer ? [id, answer] : [id])).map((r) => ({ userId: r.user_id, answer: r.answer })),
        counts(id) {
            const rows = db.prepare('SELECT answer, COUNT(*) AS n FROM event_rsvps WHERE event_id = ? GROUP BY answer').all(id);
            const get = (a) => rows.find((r) => r.answer === a)?.n ?? 0;
            return { going: get('going'), maybe: get('maybe') };
        },
    };

    return { giveaways, events };
}

module.exports = { createGiveawayService, GiveawayServiceError, MAX_ACTIVE_GIVEAWAYS };
