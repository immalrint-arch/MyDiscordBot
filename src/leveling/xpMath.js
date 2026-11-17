// Pure maths for levels. No Discord and no database in here, so it is easy to test.

const MAX_LEVEL = 500;

// XP needed to go from `level` to `level + 1`. Level 0 -> 1 needs 100, 1 -> 2 needs 155, 2 -> 3 needs 220 ...
const xpToNext = (level) => 5 * level * level + 50 * level + 100;

// Total XP a person needs to BE at `level`.
function totalXpForLevel(level) {
    const target = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));
    let total = 0;
    for (let n = 0; n < target; n++) total += xpToNext(n);
    return total;
}

function levelFromXp(xp) {
    let remaining = Math.max(0, Math.floor(xp));
    let level = 0;
    while (level < MAX_LEVEL && remaining >= xpToNext(level)) {
        remaining -= xpToNext(level);
        level++;
    }
    return level;
}

// { level, current, needed, percent } for progress bars.
function progress(xp) {
    const level = levelFromXp(xp);
    const current = Math.max(0, Math.floor(xp)) - totalXpForLevel(level);
    const needed = level >= MAX_LEVEL ? 0 : xpToNext(level);
    return { level, current, needed, percent: needed ? Math.min(100, Math.floor((current / needed) * 100)) : 100 };
}

// Random whole number from min to max (both included). `rng` is Math.random by default; tests pass their own.
function rollXp(min, max, rng = Math.random) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.floor(rng() * (hi - lo + 1));
}

// base: server multiplier in percent (100 = normal). boostPercents: the boosts of the roles the person has
// (150 = 1.5x). Only the BEST boost counts, so stacking roles cannot explode the numbers.
function applyMultipliers(xp, basePercent, boostPercents = []) {
    const best = boostPercents.length ? Math.max(100, ...boostPercents) : 100;
    return Math.max(1, Math.round(xp * (basePercent / 100) * (best / 100)));
}

// ---------- calendar periods (all in UTC) ----------
const DAY_MS = 86400000;
const dayNumber = (ms) => Math.floor(ms / DAY_MS);

// The days that belong to a period. offset 0 = the current one, -1 = the previous one.
// period: 'daily' | 'weekly' (Monday to Sunday) | 'monthly'.  Returns { startDay, endDay } (both included).
function periodRange(period, nowMs, offset = 0) {
    const today = dayNumber(nowMs);
    if (period === 'daily') return { startDay: today + offset, endDay: today + offset };
    if (period === 'weekly') {
        const monday = today - ((today + 3) % 7); // 1 Jan 1970 was a Thursday
        const start = monday + offset * 7;
        return { startDay: start, endDay: start + 6 };
    }
    if (period === 'monthly') {
        const d = new Date(nowMs);
        const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
        const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 1);
        return { startDay: dayNumber(first), endDay: dayNumber(next) - 1 };
    }
    throw new TypeError('Unknown period.');
}

// A number that changes exactly when a new period starts (used to post highlights once).
const periodKey = (period, nowMs) => periodRange(period, nowMs, 0).startDay;

const PERIOD_TITLES = { daily: 'Daily XP Highlights', weekly: 'Weekly XP Highlights', monthly: 'Monthly XP Highlights', all: 'XP Leaderboard' };

module.exports = { MAX_LEVEL, xpToNext, totalXpForLevel, levelFromXp, progress, rollXp, applyMultipliers, dayNumber, periodRange, periodKey, PERIOD_TITLES, DAY_MS };
