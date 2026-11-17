// Pure helpers for welcome / goodbye text. No Discord code, so they are easy to test.

// The words an admin can put in curly brackets. Shown by /welcome placeholders.
const PLACEHOLDERS = {
    '{user}': 'Mentions the member (@Name)',
    '{username}': 'Their account name',
    '{displayname}': 'Their nickname or display name',
    '{userid}': 'Their ID number',
    '{server}': 'The server name',
    '{count}': 'Member count, e.g. 1234',
    '{ordinal}': 'Member count with a suffix, e.g. 1,234th',
    '{created}': 'When the account was made (shows as "3 years ago")',
    '{joined}': 'When they joined (shows as "just now")',
    '{rules}': 'The rules channel, if the server has one',
};

// 1 -> "1st", 2 -> "2nd", 11 -> "11th", 1234 -> "1,234th"
function ordinal(n) {
    const number = Math.max(0, Math.floor(Number(n) || 0));
    const lastTwo = number % 100;
    const last = number % 10;
    const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
    return `${number.toLocaleString('en-US')}${suffix}`;
}

// Replaces {placeholders} in `text` with real values. Unknown words stay as typed.
// "\n" typed in a slash command becomes a real new line.
// `vars` is { user, username, displayname, userid, server, count, created, joined, rules } (all strings/numbers).
function renderTemplate(text, vars) {
    if (typeof text !== 'string') return '';
    const values = {
        user: vars.userid ? `<@${vars.userid}>` : '',
        username: vars.username ?? '',
        displayname: vars.displayname ?? vars.username ?? '',
        userid: vars.userid ?? '',
        server: vars.server ?? '',
        count: String(vars.count ?? ''),
        ordinal: ordinal(vars.count),
        created: vars.createdUnix ? `<t:${vars.createdUnix}:R>` : '',
        joined: vars.joinedUnix ? `<t:${vars.joinedUnix}:R>` : '',
        rules: vars.rulesChannelId ? `<#${vars.rulesChannelId}>` : '#rules',
    };
    return text
        .replace(/\\n/g, '\n')
        .replace(/\{(user|username|displayname|userid|server|count|ordinal|created|joined|rules)\}/gi, (_, key) => values[key.toLowerCase()]);
}

// "#ff8800", "ff8800", "0xff8800" or a few colour names -> number. Returns null if it is not a colour.
const NAMED = { red: 0xe74c3c, green: 0x2ecc71, blue: 0x5865f2, yellow: 0xf1c40f, orange: 0xe67e22, purple: 0x9b59b6, pink: 0xff69b4, black: 0x000001, white: 0xffffff, grey: 0x95a5a6, gray: 0x95a5a6 };
function parseColor(input) {
    if (typeof input !== 'string') return null;
    const text = input.trim().toLowerCase();
    if (NAMED[text] !== undefined) return NAMED[text];
    const match = text.match(/^(?:#|0x)?([0-9a-f]{6})$/);
    return match ? parseInt(match[1], 16) : null;
}

module.exports = { PLACEHOLDERS, ordinal, renderTemplate, parseColor };
