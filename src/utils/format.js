const { truncate } = require('./text');

const TYPE_LABELS = {
    warn: 'Warning',
    note: 'Note',
    kick: 'Kick',
    ban: 'Ban',
    unban: 'Unban',
    softban: 'Softban',
    timeout: 'Timeout',
    untimeout: 'Timeout removed',
    quarantine: 'Quarantine',
    unquarantine: 'Quarantine removed',
};

function typeLabel(type) {
    return TYPE_LABELS[type] ?? type;
}

// Discord can show a time in each person's own time zone using <t:SECONDS:format>.
function unixSeconds(isoText) {
    return Math.floor(new Date(isoText).getTime() / 1000);
}

// One short line describing a case, used in lists like /modlogs.
function formatCaseLine(c) {
    const pardoned = c.type === 'warn' && !c.active ? ' *(pardoned)*' : '';
    const reason = truncate(c.reason ?? 'No reason provided', 80);
    return `**#${c.caseNumber}** · ${typeLabel(c.type)}${pardoned} · <t:${unixSeconds(c.createdAt)}:d> — ${reason}`;
}

module.exports = { typeLabel, unixSeconds, formatCaseLine };
