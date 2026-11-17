// Pure helpers for the fun commands (no Discord, no database), so they are easy to test.
const MAX_AFK_REASON = 100;
const BUMP_DELAY_MS = 2 * 60 * 60 * 1000;
const DISBOARD_ID = '302050872383242240';

// ---------- small random things ----------
function hash32(text) { let h = 0x811c9dc5; for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
const pick = (list, rng = Math.random) => list[Math.floor(rng() * list.length)];
function shuffle(list, rng = Math.random) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const bar = (percent, size = 10) => { const full = Math.round((Math.max(0, Math.min(100, percent)) / 100) * size); return '▰'.repeat(full) + '▱'.repeat(size - full); };

// "2d20+3" -> { count: 2, sides: 20, mod: 3 }. Anything strange -> null.
function parseDice(text) {
    const m = String(text ?? '1d6').trim().toLowerCase().replace(/\s+/g, '').match(/^(\d{0,2})d(\d{1,4})([+-]\d{1,4})?$/);
    if (!m) return null;
    const count = m[1] === '' ? 1 : Number(m[1]); const sides = Number(m[2]); const mod = m[3] ? Number(m[3]) : 0;
    if (count < 1 || count > 20 || sides < 2 || sides > 1000) return null;
    return { count, sides, mod };
}
function rollDice({ count, sides, mod }, rng = Math.random) {
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
    return { rolls, total: rolls.reduce((a, b) => a + b, 0) + mod };
}

// "pizza | burgers, tacos" -> list (2 to 20 unique options).
function parseChoices(text) {
    const raw = String(text ?? '').includes('|') ? String(text).split('|') : String(text ?? '').split(',');
    const seen = new Set(); const list = [];
    for (const part of raw) { const t = part.replace(/\s+/g, ' ').trim(); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); list.push(t.slice(0, 100)); } }
    if (list.length < 2) return { problem: 'Give me at least 2 options, separated by commas or |.' };
    if (list.length > 20) return { problem: 'That is too many options (maximum 20).' };
    return { options: list };
}

const shipPercent = (idA, idB) => hash32([String(idA), String(idB)].sort().join('+')) % 101;
function shipLabel(p) { return p >= 90 ? 'Soulmates! 💞' : p >= 70 ? 'A great match! 💖' : p >= 50 ? 'There is potential 🙂' : p >= 30 ? 'Just friends 🤝' : p >= 10 ? 'Not very likely 😬' : 'Run! 💀'; }
const ratePercent = (text) => hash32(String(text).trim().toLowerCase()) % 11; // 0..10, same thing = same rating

// ---------- birthdays ----------
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function validateBirthday({ month, day, year }, nowYear) {
    if (!(month >= 1 && month <= 12)) return 'The month must be 1-12.';
    if (!(day >= 1 && day <= DAYS[month - 1])) return `${MONTH_NAMES[month - 1]} does not have a day ${day}.`;
    if (year != null) {
        if (year < 1900 || year > nowYear) return `The year must be between 1900 and ${nowYear}.`;
        if (month === 2 && day === 29 && !isLeap(year)) return `${year} was not a leap year, so there was no 29 February.`;
        if (nowYear - year < 13) return 'Discord requires members to be at least 13, so that year cannot be right.';
    }
    return null;
}
// The person's own calendar date, given their UTC offset in whole hours.
function localDate(nowMs, offsetHours = 0) {
    const d = new Date(nowMs + offsetHours * 3600000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return { y, m, d: day, str: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
// 29 February is celebrated on 28 February in years that have no 29th.
function effectiveDay(month, day, year) { return month === 2 && day === 29 && !isLeap(year) ? 28 : day; }
function isBirthdayToday(bd, nowMs) { const t = localDate(nowMs, bd.utcOffset); return bd.month === t.m && effectiveDay(bd.month, bd.day, t.y) === t.d; }
function ageOn(bd, nowMs) { return bd.year ? localDate(nowMs, bd.utcOffset).y - bd.year : null; }
// Whole days until the next birthday (0 = today).
function daysUntil(bd, nowMs) {
    const t = localDate(nowMs, bd.utcOffset); const today = Date.UTC(t.y, t.m - 1, t.d);
    for (const y of [t.y, t.y + 1]) { const when = Date.UTC(y, bd.month - 1, effectiveDay(bd.month, bd.day, y)); if (when >= today) return Math.round((when - today) / 86400000); }
    return 0;
}
// When the person's local day ends (to take the birthday role away).
function endOfLocalDay(nowMs, offsetHours) { const t = localDate(nowMs, offsetHours); return Date.UTC(t.y, t.m - 1, t.d + 1) - offsetHours * 3600000; }
const DEFAULT_BIRTHDAY_MESSAGE = '🎂 Happy birthday {user}! Have a wonderful day! 🎉';
function birthdayText(template, { userId, username, server, age }) {
    return String(template ?? DEFAULT_BIRTHDAY_MESSAGE).replace(/\{user\}/g, `<@${userId}>`).replace(/\{username\}/g, username).replace(/\{server\}/g, server).replace(/\{age\}/g, age == null ? '' : String(age)).slice(0, 1900);
}

// ---------- counting ----------
// Only a plain whole number counts ("12"). Everything else in the channel is ignored (people may chat).
function countingNumber(content) { const t = String(content ?? '').trim(); return /^\d{1,12}$/.test(t) ? Number(t) : null; }

function afkDuration(ms) {
    const m = Math.floor(ms / 60000); if (m < 1) return 'less than a minute';
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`; const h = Math.floor(m / 60);
    if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`; return `${Math.floor(h / 24)} days`;
}

module.exports = { MAX_AFK_REASON, BUMP_DELAY_MS, DISBOARD_ID, hash32, pick, shuffle, bar, parseDice, rollDice, parseChoices, shipPercent, shipLabel, ratePercent,
    validateBirthday, localDate, isBirthdayToday, ageOn, daysUntil, endOfLocalDay, effectiveDay, isLeap, MONTH_NAMES, birthdayText, DEFAULT_BIRTHDAY_MESSAGE, countingNumber, afkDuration };
