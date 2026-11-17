const { PermissionFlagsBits: P } = require('discord.js');

const MEMBER_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
const STAFF_ALLOW = [...MEMBER_ALLOW, P.ManageMessages];
const BOT_ALLOW = [...STAFF_ALLOW, P.ManageChannels];

// Who may see a ticket channel: the person who opened it, the staff roles and the bot. Nobody else.
function buildOverwrites({ everyoneId, openerId, staffRoleIds, botId }) {
    return [
        { id: everyoneId, deny: [P.ViewChannel] },
        { id: botId, allow: BOT_ALLOW },
        { id: openerId, allow: MEMBER_ALLOW },
        ...staffRoleIds.map((id) => ({ id, allow: STAFF_ALLOW })),
    ];
}

// Staff = has a configured staff role, or is an administrator.
function isStaff({ roleIds, isAdministrator }, staffRoleIds) {
    return Boolean(isAdministrator) || roleIds.some((id) => staffRoleIds.includes(id));
}

// A safe channel name: lowercase letters, numbers and dashes only.
function cleanChannelName(text) {
    const name = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
    return name || 'ticket';
}

const ticketChannelName = (number) => `ticket-${String(number).padStart(4, '0')}`;

module.exports = { buildOverwrites, isStaff, cleanChannelName, ticketChannelName, MEMBER_ALLOW, STAFF_ALLOW, BOT_ALLOW };
