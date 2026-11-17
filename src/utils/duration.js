// Turns text like "10m", "2h", "1d12h" into milliseconds.

const UNIT_MS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
};

const WHOLE_TEXT = /^(\d{1,9}[smhdw])+$/i; // one or more "number + unit" pieces
const ONE_PIECE = /(\d{1,9})([smhdw])/gi;

// Returns the number of milliseconds, or null if the text is not a valid duration.
function parseDuration(input) {
    if (typeof input !== 'string') return null;

    // Remove spaces ("1h 30m" becomes "1h30m"). The length limit stops silly inputs.
    const text = input.replace(/\s+/g, '');
    if (text.length === 0 || text.length > 40 || !WHOLE_TEXT.test(text)) return null;

    let total = 0;
    for (const piece of text.matchAll(ONE_PIECE)) {
        total += Number(piece[1]) * UNIT_MS[piece[2].toLowerCase()];
    }
    return total > 0 ? total : null;
}

// Turns milliseconds back into friendly text, e.g. 5400000 -> "1h 30m".
function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0s';

    const parts = [];
    let rest = Math.floor(ms / 1000);
    for (const [label, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
        const amount = Math.floor(rest / size);
        if (amount > 0) parts.push(`${amount}${label}`);
        rest -= amount * size;
    }
    return parts.join(' ');
}

module.exports = { parseDuration, formatDuration, UNIT_MS };
