// Pure helpers for raid mode (no Discord, no database).
const LIMITS = { joins: [3, 100], seconds: [5, 300], duration_minutes: [1, 240] };
const DEFAULTS = { joins: 10, seconds: 30, duration_minutes: 15, action: 'alert' };
const ACTIONS = ['alert', 'timeout', 'kick'];
const TIMEOUT_MS = 60 * 60 * 1000;
const HIGH = 3; // Discord "High" verification level (must have been a member of Discord for 10+ minutes)
const MAX_TRACKED = 200;

const inRange = (n, [lo, hi]) => Number.isInteger(n) && n >= lo && n <= hi;
const checkSetting = (key, value) => inRange(value, LIMITS[key]);

// Remembers recent joins per server and says when there are too many too fast.
function createJoinTracker() {
    const joins = new Map(); // guildId -> [{ id, at }]
    return {
        // returns the ids that joined inside the window when the limit was reached, otherwise null
        record(guildId, userId, at, { joins: limit, seconds }) {
            const list = (joins.get(guildId) ?? []).filter((j) => at - j.at <= seconds * 1000 && j.id !== userId);
            list.push({ id: userId, at }); if (list.length > MAX_TRACKED) list.splice(0, list.length - MAX_TRACKED);
            joins.set(guildId, list);
            if (list.length >= limit) { joins.delete(guildId); return list.map((j) => j.id); }
            return null;
        },
        clear(guildId) { joins.delete(guildId); },
        size: () => joins.size,
    };
}

// Should the raid be over? Rolling: the clock restarts at every raider.
const isExpired = (lastJoinAt, durationMinutes, nowMs) => nowMs >= lastJoinAt + durationMinutes * 60 * 1000;
const describeAction = (a) => ({ alert: 'only warn staff', timeout: 'time them out for 1 hour', kick: 'kick them' }[a] ?? a);

module.exports = { LIMITS, DEFAULTS, ACTIONS, TIMEOUT_MS, HIGH, MAX_TRACKED, checkSetting, createJoinTracker, isExpired, describeAction };
