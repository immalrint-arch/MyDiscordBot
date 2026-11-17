// Pure text checks for auto-moderation. No Discord code here, so they are easy to test.

const URL_RE = /https?:\/\/[^\s<>]+/gi;
const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg)\/([a-z0-9-]{2,32})/gi;
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;
const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}/gu;

// Removes things that should never count as "shouting": code blocks, links, mentions and custom emojis.
function stripNoise(content) {
    return content
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(URL_RE, ' ')
        .replace(/<(?:@!?|@&|#)\d+>/g, ' ')
        .replace(CUSTOM_EMOJI_RE, ' ');
}

// Smart caps check. "WHATTTTTT" must NOT be punished, so:
//  1. repeated letters are squashed first (WHATTTTTT -> WHAT),
//  2. short messages are ignored (fewer than 10 letters),
//  3. the message needs a high share of capitals.
function isExcessiveCaps(content, percent = 70, minLetters = 10) {
    const squashed = stripNoise(content).replace(/(\p{L})\1+/gu, '$1');
    const letters = [...squashed].filter((c) => /\p{L}/u.test(c));
    if (letters.length < minLetters) return false;
    const upper = letters.filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length;
    return (upper / letters.length) * 100 >= percent;
}

// The first invite code found that is not on the allowed list.
function findInvite(content, allowedCodes = []) {
    const allowed = new Set(allowedCodes.map((c) => c.toLowerCase()));
    for (const match of content.matchAll(INVITE_RE)) {
        if (!allowed.has(match[1].toLowerCase())) return match[1];
    }
    return null;
}

// The first link whose website is not allowed. Allowing "example.com" also allows "www.example.com".
function findLink(content, allowedDomains = []) {
    const allowed = allowedDomains.map((d) => d.toLowerCase());
    for (const url of content.match(URL_RE) ?? []) {
        let host;
        try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
        if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) return host;
    }
    return null;
}

// Makes tricks like "f.r.e.e", "fr33" or "FRÉE" easier to compare.
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
function normalizeText(text) {
    return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[01345 7@$!]/g, (c) => LEET[c] ?? c);
}

// The first banned word found. Matches whole words only, so "class" never trips a word like "ass".
// Letters spread out with dots or dashes ("b.a.d") are also caught.
function findBannedWord(content, words) {
    if (words.length === 0) return null;
    const text = normalizeText(stripNoise(content));
    const squeezed = text.replace(/(?<=\p{L})[.\-_*]+(?=\p{L})/gu, '');
    const tokens = new Set([...text.split(/[^\p{L}\p{N}]+/u), ...squeezed.split(/[^\p{L}\p{N}]+/u)].filter(Boolean));
    for (const word of words) {
        const w = normalizeText(word).trim();
        if (!w) continue;
        if (w.includes(' ')) {
            if ((' ' + text.replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ').includes(` ${w} `)) return word;
        } else if (tokens.has(w)) {
            return word;
        }
    }
    return null;
}

function countEmojis(content) {
    return (content.match(CUSTOM_EMOJI_RE) ?? []).length + (content.match(UNICODE_EMOJI_RE) ?? []).length;
}

// What counts as "the same message": ignore case, spaces and punctuation.
const duplicateKey = (content) => content.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Remembers recent messages per person, for the spam and repeat checks.
function createSpamTracker({ now = Date.now } = {}) {
    const history = new Map(); // "guild:user" -> [{ at, key }]
    const MAX_AGE_MS = 120 * 1000;
    return {
        record(guildId, userId, content) {
            const k = `${guildId}:${userId}`;
            const t = now();
            const list = (history.get(k) ?? []).filter((e) => e.at > t - MAX_AGE_MS);
            list.push({ at: t, key: duplicateKey(content) });
            if (list.length > 60) list.shift();
            history.set(k, list);
        },
        countRecent(guildId, userId, windowSec) {
            const t = now();
            return (history.get(`${guildId}:${userId}`) ?? []).filter((e) => e.at > t - windowSec * 1000).length;
        },
        countDuplicates(guildId, userId, content, windowSec) {
            const key = duplicateKey(content);
            if (!key) return 0;
            const t = now();
            return (history.get(`${guildId}:${userId}`) ?? []).filter((e) => e.at > t - windowSec * 1000 && e.key === key).length;
        },
        forget(guildId, userId) { history.delete(`${guildId}:${userId}`); },
        sweep() {
            const t = now();
            for (const [k, list] of history) if (list.every((e) => e.at <= t - MAX_AGE_MS)) history.delete(k);
        },
    };
}

module.exports = { stripNoise, isExcessiveCaps, findInvite, findLink, findBannedWord, countEmojis, createSpamTracker, normalizeText };
