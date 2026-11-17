// Cuts text that is too long and adds "…" at the end.
function truncate(text, max) {
    if (typeof text !== 'string') return '';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Cleans text typed by a user: removes invisible control characters,
// squeezes extra spaces, and limits the length. Returns null if nothing is left.
function cleanText(input, max) {
    if (typeof input !== 'string') return null;
    const cleaned = input
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (cleaned.length === 0) return null;
    return truncate(cleaned, max);
}

// Discord's audit log accepts reasons up to 512 characters, so we use that limit everywhere.
const MAX_REASON_LENGTH = 512;

function cleanReason(input) {
    return cleanText(input, MAX_REASON_LENGTH);
}

module.exports = { truncate, cleanText, cleanReason, MAX_REASON_LENGTH };
