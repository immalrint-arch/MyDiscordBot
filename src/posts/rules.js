// Pure rules for embeds, scheduled posts and sticky messages.
const { parseDuration } = require('../utils/duration');

const MAX_TITLE = 256, MAX_DESCRIPTION = 4000, MAX_FOOTER = 200, MAX_CONTENT = 1900, MAX_EMBED_TOTAL = 5500;
const MAX_SCHEDULED = 25, MAX_STICKY = 10;
const MIN_REPEAT_S = 600, MAX_REPEAT_S = 30 * 86400, MAX_AHEAD_MS = 366 * 86400000, MAX_LATE_MS = 24 * 3600000, MAX_RUNS = 1000;
const DEFAULT_COLOR = 0x5865f2;
const COLOR_NAMES = { red: 0xed4245, green: 0x57f287, blue: 0x3498db, blurple: 0x5865f2, yellow: 0xfee75c, orange: 0xe67e22, purple: 0x9b59b6, pink: 0xeb459e, white: 0xffffff, black: 0x23272a, grey: 0x95a5a6, gray: 0x95a5a6, gold: 0xf1c40f, teal: 0x1abc9c };

// "#ff0000", "ff0000", "red" -> number. null = not a colour. empty -> default.
function parseColor(input) {
    const t = String(input ?? '').trim().toLowerCase();
    if (!t) return DEFAULT_COLOR;
    if (COLOR_NAMES[t] !== undefined) return COLOR_NAMES[t];
    const m = /^#?([0-9a-f]{6})$/.exec(t); return m ? parseInt(m[1], 16) : null;
}
// \n typed as text becomes a real line break; trims; empty -> null.
function cleanText(input, max) {
    const t = String(input ?? '').replace(/\\n/g, '\n').replace(/\u0000/g, '').trim();
    return t && t.length <= max ? t : null;
}
const isUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && x.hostname.includes('.') && String(u).length <= 500; } catch { return false; } };

// Checks the pieces and returns { embed } (plain object, or null if nothing to show) or { problem }.
function buildEmbedData({ title, description, color, footer, image, thumbnail }) {
    const e = {};
    if (title) { const t = cleanText(title, MAX_TITLE); if (!t) return { problem: `The title must be 1 to ${MAX_TITLE} characters.` }; e.title = t; }
    if (description) { const d = cleanText(description, MAX_DESCRIPTION); if (!d) return { problem: `The description must be 1 to ${MAX_DESCRIPTION} characters.` }; e.description = d; }
    if (footer) { const f = cleanText(footer, MAX_FOOTER); if (!f) return { problem: `The footer must be 1 to ${MAX_FOOTER} characters.` }; e.footer = f; }
    for (const [key, v] of [['image', image], ['thumbnail', thumbnail]]) if (v) { if (!isUrl(v)) return { problem: `The ${key} must be a link that starts with https://` }; e[key] = String(v).trim(); }
    const c = parseColor(color); if (c === null) return { problem: 'The colour must look like #5865F2 or be a name like red, green, blue.' };
    if (!e.title && !e.description && !e.image && !e.thumbnail) return { embed: null };
    e.color = c;
    if ((e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.length ?? 0) > MAX_EMBED_TOTAL) return { problem: 'That embed is too long.' };
    return { embed: e };
}

// "30m", "2h", "1d" or "2026-12-25 09:00" (read in the given UTC offset). Returns a time in ms, or { problem }.
function parseWhen(input, { now, utcOffset = 0 }) {
    const text = String(input ?? '').trim(); let at;
    const ms = parseDuration(text);
    if (ms) at = now + ms;
    else {
        const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(text);
        if (!m) return { problem: 'Write the time like `2h` or `1d12h` (from now), or a date like `2026-12-25 09:00`.' };
        const [y, mo, d, h, mi] = m.slice(1).map(Number);
        if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return { problem: 'That date or time does not exist.' };
        const date = new Date(Date.UTC(y, mo - 1, d, h, mi)); if (date.getUTCMonth() !== mo - 1) return { problem: 'That date does not exist.' };
        at = date.getTime() - utcOffset * 3600000;
    }
    if (at <= now) return { problem: 'That time has already passed.' };
    if (at - now > MAX_AHEAD_MS) return { problem: 'That is more than a year away.' };
    return { at };
}
// After a repeating post ran (or was missed), the next slot that is still in the future.
function nextSlot(previous, intervalMs, now) { return previous + (Math.floor(Math.max(0, now - previous) / intervalMs) + 1) * intervalMs; }
const preview = (p) => { const t = p.content ?? p.embed?.title ?? p.embed?.description ?? '(picture only)'; const s = String(t).replace(/\s+/g, ' '); return s.length > 60 ? `${s.slice(0, 59)}…` : s; };

module.exports = { MAX_TITLE, MAX_DESCRIPTION, MAX_FOOTER, MAX_CONTENT, MAX_SCHEDULED, MAX_STICKY, MIN_REPEAT_S, MAX_REPEAT_S, MAX_LATE_MS, MAX_RUNS, DEFAULT_COLOR, parseColor, cleanText, isUrl, buildEmbedData, parseWhen, nextSlot, preview };
