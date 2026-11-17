// Pure text helpers for log embeds (no Discord code, so they are easy to test).
// The look follows your reference images: bold labels, Discord timestamps that
// show both a date and "x days ago", and small grey footer lines.

const DAY_MS = 24 * 60 * 60 * 1000;

// Discord shows <t:SECONDS:f> in each viewer's own time zone, and :R as "4 days ago".
function stamp(dateLike, style = 'f') {
    const ms = dateLike instanceof Date ? dateLike.getTime() : Number(dateLike);
    return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

// "July 2, 2025 (a year ago)" in Discord's own formatting.
function dateWithAgo(dateLike) {
    return `${stamp(dateLike, 'D')} (${stamp(dateLike, 'R')})`;
}

function line(label, value) {
    return `**${label}:** ${value}`;
}

function truncate(text, max) {
    const value = String(text ?? '');
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Builds the description of an embed:
//   headline
//   (blank line)
//   **Label:** value lines
//   (blank line)
//   -# small footer lines
function buildDescription({ headline, lines = [], footer = [] }) {
    const parts = [headline];
    if (lines.length) parts.push('', ...lines);
    if (footer.length) parts.push('', ...footer.map((f) => `-# ${f}`));
    return truncate(parts.join('\n'), 4000);
}

// The two small footer lines used under member-related logs.
function memberFooter({ displayName, username, id, when = new Date() }) {
    const name = displayName && displayName !== username ? `${displayName} (@${username})` : `@${username}`;
    return [`Member: ${truncate(name, 100)} | Time: ${stamp(when, 'f')}`, `Member \`${id}\``];
}

// Is this account suspiciously new (created within the last `hours` hours)?
function isNewAccount(createdTimestamp, now = Date.now(), hours = 24) {
    return now - createdTimestamp < hours * 60 * 60 * 1000;
}

// "ManageMessages" becomes "Manage Messages".
function readablePermission(name) {
    return String(name).replace(/([a-z])([A-Z])/g, '$1 $2');
}

function permissionList(names, max = 900) {
    if (!names || names.length === 0) return 'None';
    return truncate(names.map(readablePermission).join(', '), max);
}

// "GuildText" becomes "Text", "GuildVoice" becomes "Voice".
function readableChannelType(name) {
    return String(name ?? 'Unknown').replace(/^Guild/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

// Shows a role colour as hex, or "Default (no colour)".
function colorText(color) {
    return color ? `#${color.toString(16).padStart(6, '0')}` : 'Default (no colour)';
}

// Compares two lists and says what was added and what was removed.
function diffLists(before, after) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    return {
        added: after.filter((x) => !beforeSet.has(x)),
        removed: before.filter((x) => !afterSet.has(x)),
    };
}

// Message content shown in a quote block, shortened and with pings neutralised
// (the log service also forbids pings, this just keeps the text tidy).
function quoteBlock(text, max = 1000) {
    const cleaned = truncate(text, max).replace(/\n/g, '\n> ');
    return cleaned.length ? `> ${cleaned}` : '*(no text)*';
}

module.exports = {
    DAY_MS,
    stamp,
    dateWithAgo,
    line,
    truncate,
    buildDescription,
    memberFooter,
    isNewAccount,
    readablePermission,
    permissionList,
    readableChannelType,
    colorText,
    diffLists,
    quoteBlock,
};
