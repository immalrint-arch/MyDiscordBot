const { Events, AuditLogEvent } = require('discord.js');
const { DANGEROUS_PERMISSIONS } = require('../../antinuke/rules');
const { diffLists } = require('../../logging/textFormat');

// Granting dangerous permissions to a role (especially @everyone) is a warning sign.
module.exports = {
    name: Events.GuildRoleUpdate,
    async execute(oldRole, newRole) {
        const { antinuke } = newRole.client.services;
        const guild = newRole.guild;
        if (!antinuke.isEnabled(guild.id)) return;

        const { added } = diffLists(oldRole.permissions.toArray(), newRole.permissions.toArray());
        const dangerous = added.filter((p) => DANGEROUS_PERMISSIONS.includes(p));
        if (dangerous.length === 0) return;

        const result = await antinuke.handleSignal(guild, {
            rule: 'dangerousPermission',
            targetId: newRole.id,
            targetName: `@${newRole.name}: +${dangerous.join(', ')}`,
            auditType: AuditLogEvent.RoleUpdate,
        });

        // Nobody has a good reason to give @everyone these powers. In "contain" mode we undo it.
        if (result && !result.ignored && newRole.id === guild.id) {
            await antinuke.revertEveryonePermissions(guild, newRole, dangerous, result.actorClass);
        }
    },
};
