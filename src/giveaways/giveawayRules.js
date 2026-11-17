// Pure rules for giveaways and events. No Discord and no database in here, so they are easy to test.
const { parseDuration } = require('../utils/duration');

const MIN_DURATION_MS = 10 * 1000;
const MAX_DURATION_MS = 60 * 24 * 3600 * 1000;
const DAY_MS = 86400000;

// Picks `count` different winners at random (a fair shuffle). rng() must return a number from 0 up to (not including) 1.
function pickWinners(userIds, count, rng = Math.random) {
    const pool = [...new Set(userIds)];
    const winners = [];
    while (winners.length < count && pool.length) {
        const index = Math.floor(rng() * pool.length);
        winners.push(pool.splice(index, 1)[0]);
    }
    return winners;
}

// Why this person may NOT enter (null = fine).
//   giveaway: { requiredRoleId, bypassRoleId, minLevel, minDays }
//   person:   { roleIds: [], level, joinedAt (ms or null) }
function entryProblem(giveaway, person, now = Date.now()) {
    if (giveaway.bypassRoleId && person.roleIds.includes(giveaway.bypassRoleId)) return null;
    if (giveaway.requiredRoleId && !person.roleIds.includes(giveaway.requiredRoleId)) return `You need the <@&${giveaway.requiredRoleId}> role to enter.`;
    if (giveaway.minLevel > 0 && (person.level ?? 0) < giveaway.minLevel) return `You need to be at least level **${giveaway.minLevel}** to enter (you are level ${person.level ?? 0}).`;
    if (giveaway.minDays > 0) {
        const days = person.joinedAt ? Math.floor((now - person.joinedAt) / DAY_MS) : 0;
        if (days < giveaway.minDays) return `You must have been in this server for **${giveaway.minDays} day(s)** to enter.`;
    }
    return null;
}

// "2h", "30m" (from now)  or  "2026-12-24 18:00" (UTC, shifted by offsetHours so people can type their own time).
// Returns a time in milliseconds, or null.
function parseWhen(input, { now = Date.now(), offsetHours = 0 } = {}) {
    const text = String(input ?? '').trim();
    if (!text) return null;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
    if (match) {
        const [, y, mo, d, h, mi] = match.map(Number);
        if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
        const ms = Date.UTC(y, mo - 1, d, h, mi) - offsetHours * 3600000;
        const check = new Date(Date.UTC(y, mo - 1, d, h, mi));
        if (check.getUTCMonth() !== mo - 1) return null; // e.g. 31 February
        return ms;
    }
    const duration = parseDuration(text);
    return duration ? now + duration : null;
}

const unix = (ms) => Math.floor(ms / 1000);

module.exports = { pickWinners, entryProblem, parseWhen, unix, MIN_DURATION_MS, MAX_DURATION_MS, DAY_MS };
