const { Events, AuditLogEvent } = require('discord.js');
const { roleCard } = require('../logging/roleCard');

module.exports = {
    name: Events.GuildRoleCreate,
    async execute(role) {
        const { logs, audit } = role.client.services;
        const entry = await audit.findEntry(role.guild, AuditLogEvent.RoleCreate, { targetId: role.id });
        await logs.send(role.guild, 'roles', { embeds: [roleCard({ role, created: true, entry })] });
    },
};
