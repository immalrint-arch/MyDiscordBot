const { Events, AuditLogEvent } = require('discord.js');
const { DANGEROUS_PERMISSIONS } = require('../../antinuke/rules');

module.exports = {
    name: Events.GuildRoleCreate,
    async execute(role) {
        const { antinuke } = role.client.services;
        if (!antinuke.isEnabled(role.guild.id)) return;

        await antinuke.handleSignal(role.guild, {
            rule: 'roleCreate',
            targetId: role.id,
            targetName: `@${role.name}`,
            auditType: AuditLogEvent.RoleCreate,
        });

        // A brand-new role that already has dangerous powers is its own signal.
        const dangerous = DANGEROUS_PERMISSIONS.filter((p) => role.permissions.has(p, false));
        if (dangerous.length > 0) {
            await antinuke.handleSignal(role.guild, {
                rule: 'dangerousPermission',
                targetId: role.id,
                targetName: `@${role.name} created with: ${dangerous.join(', ')}`,
                auditType: AuditLogEvent.RoleCreate,
            });
        }
    },
};
