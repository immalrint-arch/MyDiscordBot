// Counts recent actions per person using a "sliding window":
// we remember WHEN each action happened, and only count the ones inside the window.
// This file has no Discord code, so it is easy to test.
const KEEP_MS = 10 * 60 * 1000; // forget anything older than 10 minutes
const MAX_PER_KEY = 500; // memory safety

function createDetector({ now = Date.now } = {}) {
    const events = new Map(); // "guild:actor:rule" -> list of timestamps

    const keyOf = (guildId, actorId, rule) => `${guildId}:${actorId}:${rule}`;

    function record(guildId, actorId, rule, at = now()) {
        const key = keyOf(guildId, actorId, rule);
        const list = events.get(key) ?? [];
        list.push(at);
        const cutoff = at - KEEP_MS;
        const fresh = list.filter((t) => t >= cutoff).slice(-MAX_PER_KEY);
        events.set(key, fresh);
    }

    function count(guildId, actorId, rule, windowMs) {
        const list = events.get(keyOf(guildId, actorId, rule));
        if (!list) return 0;
        const since = now() - windowMs;
        return list.filter((t) => t >= since).length;
    }

    // thresholds looks like { channelDelete: { threshold: 3, windowSec: 10 }, ... }
    // Returns every rule whose limit has been reached by this actor.
    function evaluate(guildId, actorId, thresholds) {
        const breaches = [];
        for (const [rule, { threshold, windowSec }] of Object.entries(thresholds)) {
            const total = count(guildId, actorId, rule, windowSec * 1000);
            if (total >= threshold) breaches.push({ rule, count: total, threshold, windowSec });
        }
        return breaches;
    }

    function clearActor(guildId, actorId) {
        const prefix = `${guildId}:${actorId}:`;
        for (const key of events.keys()) if (key.startsWith(prefix)) events.delete(key);
    }

    return { record, count, evaluate, clearActor };
}

module.exports = { createDetector };
