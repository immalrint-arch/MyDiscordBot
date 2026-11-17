const { Events, AuditLogEvent } = require('discord.js');

module.exports = {
    name: Events.GuildRoleDelete,
    async execute(role) {
        const { antinuke } = role.client.services;
        if (!antinuke.isEnabled(role.guild.id)) return;
        await antinuke.handleSignal(role.guild, {
            rule: 'roleDelete',
            targetId: role.id,
            targetName: `@${role.name}`,
            auditType: AuditLogEvent.RoleDelete,
            snapshot: { kind: 'role', original: role },
        });
    },
};
