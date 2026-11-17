// The kinds of logs Incomu can write. Each one can have its own channel.
const LOG_CATEGORIES = {
    messages: 'Message edits, deletions and bulk deletions',
    members: 'Joins, leaves, kicks, bans, nicknames, role changes, timeouts, rules accepted',
    roles: 'Role created, deleted or changed',
    channels: 'Channel created, deleted or changed',
    voice: 'Voice joins, leaves, moves, mute and deafen changes',
    server: 'Invites and other server-level events',
    moderation: 'Cases and actions from the moderation commands',
    automod: 'Automatic actions by auto-moderation (kept apart from manual moderation)',
};

const CATEGORY_NAMES = Object.keys(LOG_CATEGORIES);

module.exports = { LOG_CATEGORIES, CATEGORY_NAMES };
