// Pure text helpers for the quote picture. No Discord and no drawing in here,
// so they are easy to test.
const { truncate } = require('../utils/text');

const MAX_QUOTE_CHARS = 500;

// Turns a raw Discord message into text that looks good in a picture.
// Pass message.cleanContent (Discord already turns <@123> into @Name for us).
function cleanQuoteText(raw) {
    if (typeof raw !== 'string') return '';
    let text = raw
        .replace(/<a?:(\w+):\d+>/g, ':$1:') // custom emoji -> :name:
        .replace(/<t:\d+(?::[a-zA-Z])?>/g, '') // Discord timestamps
        .replace(/\|\|[\s\S]*?\|\|/g, '[spoiler]') // never reveal spoilers in a picture
        .replace(/```[a-z]*\n?([\s\S]*?)```/gi, '$1') // code fences -> plain text
        .replace(/`([^`]+)`/g, '$1')
        .replace(/~~([\s\S]*?)~~/g, '$1')
        .replace(/^>\s?/gm, '') // block quotes
        .replace(/^#{1,3}\s+/gm, '') // headings
        .replace(/https?:\/\/\S+/g, (url) => (url.length > 40 ? `${url.slice(0, 37)}…` : url))
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return truncate(text, MAX_QUOTE_CHARS);
}

// "**bold**", "*italic*", "_italic_", "__underline__ (shown as plain)" -> list of pieces.
// Each piece is { text, bold, italic }. Unmatched stars are left as normal text.
function parseInline(text) {
    const pieces = [];
    let bold = false;
    let italic = false;
    let buffer = '';
    const flush = () => {
        if (buffer) pieces.push({ text: buffer, bold, italic });
        buffer = '';
    };
    // Only toggle a style when a closing marker exists later in the text.
    const hasLater = (marker, from) => text.indexOf(marker, from) !== -1;

    for (let i = 0; i < text.length; ) {
        if (text.startsWith('**', i) && (bold || hasLater('**', i + 2))) {
            flush(); bold = !bold; i += 2;
        } else if (text.startsWith('__', i) && hasLater('__', i + 2)) {
            flush(); i += 2; // underline is not drawn, we just drop the markers
        } else if ((text[i] === '*' || text[i] === '_') && text[i + 1] !== text[i] && (italic || hasLater(text[i], i + 1))) {
            // "_" inside a word (snake_case) must stay as it is
            if (text[i] === '_' && /\w/.test(text[i - 1] ?? '') && !italic) { buffer += text[i]; i += 1; continue; }
            flush(); italic = !italic; i += 1;
        } else {
            buffer += text[i];
            i += 1;
        }
    }
    flush();
    return pieces;
}

// Word-wraps styled pieces into lines.
// measure(text, bold, italic) must return the width in pixels.
// Returns an array of lines; each line is an array of { text, bold, italic, width }.
function wrapPieces(pieces, measure, maxWidth) {
    const lines = [[]];
    let lineWidth = 0;

    const newLine = () => {
        const last = lines[lines.length - 1];
        // drop the space at the end of the finished line
        if (last.length) {
            const run = last[last.length - 1];
            const trimmed = run.text.replace(/\s+$/, '');
            if (trimmed !== run.text) {
                run.text = trimmed;
                run.width = measure(trimmed, run.bold, run.italic);
            }
        }
        lines.push([]);
        lineWidth = 0;
    };
    const place = (text, bold, italic) => {
        const width = measure(text, bold, italic);
        if (lineWidth + measure(text.replace(/\s+$/, ''), bold, italic) > maxWidth && lineWidth > 0) newLine();
        lines[lines.length - 1].push({ text, bold, italic, width });
        lineWidth += width;
    };

    for (const piece of pieces) {
        const parts = piece.text.split('\n');
        parts.forEach((part, partIndex) => {
            if (partIndex > 0) newLine(); // a real line break in the message
            for (const word of part.match(/\S+\s*|\s+/g) ?? []) {
                if (word.trim() === '' && lineWidth === 0) continue; // no leading spaces
                if (measure(word.trim(), piece.bold, piece.italic) <= maxWidth) {
                    place(word, piece.bold, piece.italic);
                } else {
                    // one huge word (like a long link): cut it into chunks that fit
                    let chunk = '';
                    for (const ch of word.trim()) {
                        if (measure(chunk + ch, piece.bold, piece.italic) > maxWidth && chunk) {
                            place(chunk, piece.bold, piece.italic);
                            newLine();
                            chunk = '';
                        }
                        chunk += ch;
                    }
                    if (chunk) place(chunk + ' ', piece.bold, piece.italic);
                }
            }
        });
    }
    // remove trailing empty lines and trailing spaces
    while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
    const last = lines[lines.length - 1];
    if (last.length) {
        const run = last[last.length - 1];
        run.text = run.text.replace(/\s+$/, '');
        run.width = measure(run.text, run.bold, run.italic);
    }
    return lines;
}

// Bigger letters for short quotes, smaller for long ones.
function pickFontSize(length) {
    if (length <= 40) return 54;
    if (length <= 90) return 44;
    if (length <= 160) return 36;
    if (length <= 280) return 30;
    return 25;
}

module.exports = { cleanQuoteText, parseInline, wrapPieces, pickFontSize, MAX_QUOTE_CHARS };
