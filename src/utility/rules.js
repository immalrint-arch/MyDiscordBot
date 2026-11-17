// Pure helpers for Milestone 14 (no Discord code, easy to test).
const { isSnowflake } = require('../utils/snowflake');

// ---- polls ----
const MIN_OPTIONS = 2, MAX_OPTIONS = 10, MAX_OPTION_LENGTH = 80, MAX_QUESTION = 250;
// "Pizza | Burgers | Tacos" (also ; or new lines). Returns { ok, options } or { ok:false, problem }.
function parseOptions(text) {
    const list = String(text ?? '').split(/[|;\n]/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const seen = new Set(); const unique = list.filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); // keeps the first spelling
    if (unique.length < MIN_OPTIONS) return { ok: false, problem: `Give at least ${MIN_OPTIONS} different options, separated by | (example: Pizza | Burgers | Tacos).` };
    if (unique.length > MAX_OPTIONS) return { ok: false, problem: `A poll can have at most ${MAX_OPTIONS} options.` };
    if (unique.some((s) => s.length > MAX_OPTION_LENGTH)) return { ok: false, problem: `Each option can be at most ${MAX_OPTION_LENGTH} characters.` };
    return { ok: true, options: unique };
}
// counts[i] = votes for option i. Returns [{ index, count, percent }]
function tally(optionCount, votes) {
    const counts = Array(optionCount).fill(0);
    for (const v of votes) if (v.option_index >= 0 && v.option_index < optionCount) counts[v.option_index]++;
    const total = counts.reduce((a, b) => a + b, 0);
    return counts.map((count, index) => ({ index, count, percent: total ? Math.round((count / total) * 100) : 0 }));
}
const bar = (percent, width = 10) => { const filled = Math.round((percent / 100) * width); return '▰'.repeat(filled) + '▱'.repeat(width - filled); };

// ---- reminders ----
const MAX_REMINDERS_PER_USER = 25, MIN_REMIND_MS = 10 * 1000, MAX_REMIND_MS = 365 * 864e5, MAX_REMIND_TEXT = 500;

// ---- suggestions ----
const MAX_SUGGESTION = 1500;
const SUGGESTION_STATUS = {
    pending: { label: 'Pending', color: 0x5865f2, emoji: '🕒' }, considered: { label: 'Being considered', color: 0xf1c40f, emoji: '🤔' },
    approved: { label: 'Approved', color: 0x2ecc71, emoji: '✅' }, denied: { label: 'Denied', color: 0xe74c3c, emoji: '❌' },
};

// ---- starboard ----
// What to do about a message, given how many (valid) stars it has.
//   existing: the saved post or null.  Returns 'create' | 'update' | 'remove' | 'none'.
function starAction(count, threshold, existing) {
    if (count >= threshold) return existing ? (existing.stars === count ? 'none' : 'update') : 'create';
    return existing ? 'remove' : 'none';
}
// Does this reaction's emoji match the configured one? (unicode emoji or custom emoji name/id)
function emojiMatches(configEmoji, emoji) {
    if (!emoji) return false;
    const id = String(configEmoji).match(/^<a?:\w+:(\d+)>$/)?.[1] ?? (isSnowflake(configEmoji) ? configEmoji : null);
    return id ? emoji.id === id : emoji.name === configEmoji;
}
// Accepts "⭐", "<:name:123>" or an emoji ID. Returns the text to store, or null.
function parseEmojiInput(text) {
    const t = String(text ?? '').trim();
    if (/^<a?:\w+:\d{17,20}>$/.test(t) || isSnowflake(t)) return t;
    if (t && [...t].length <= 8 && /\p{Extended_Pictographic}/u.test(t)) return t;
    return null;
}

module.exports = {
    MIN_OPTIONS, MAX_OPTIONS, MAX_OPTION_LENGTH, MAX_QUESTION, parseOptions, tally, bar,
    MAX_REMINDERS_PER_USER, MIN_REMIND_MS, MAX_REMIND_MS, MAX_REMIND_TEXT, MAX_SUGGESTION, SUGGESTION_STATUS,
    starAction, emojiMatches, parseEmojiInput,
};
