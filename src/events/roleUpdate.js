const { Events, AuditLogEvent } = require('discord.js');
const { COLORS, logEmbed, actorText } = require('../logging/style');
const { line, colorText, readablePermission, diffLists, stamp } = require('../logging/textFormat');

module.exports = {
    name: Events.GuildRoleUpdate,
    async execute(oldRole, newRole) {
        const { logs, audit } = newRole.client.services;
        const changes = [];

        if (oldRole.name !== newRole.name) changes.push(`• **Name:** ${oldRole.name} → **${newRole.name}**`);
        if (oldRole.color !== newRole.color) {
            changes.push(`• **Colour:** ${colorText(oldRole.color)} → **${colorText(newRole.color)}**`);
        }
        if (oldRole.hoist !== newRole.hoist) changes.push(`• **Shown separately:** ${oldRole.hoist} → **${newRole.hoist}**`);
        if (oldRole.mentionable !== newRole.mentionable) {
            changes.push(`• **Mentionable:** ${oldRole.mentionable} → **${newRole.mentionable}**`);
        }

        const { added, removed } = diffLists(oldRole.permissions.toArray(), newRole.permissions.toArray());
        if (added.length) changes.push(`• **Permissions added:** ${added.map(readablePermission).join(', ')}`);
        if (removed.length) changes.push(`• **Permissions removed:** ${removed.map(readablePermission).join(', ')}`);

        // Moving a role up/down only changes its position. That is noisy, so we skip it.
        if (changes.length === 0) return;

        const entry = await audit.findEntry(newRole.guild, AuditLogEvent.RoleUpdate, { targetId: newRole.id });
        const embed = logEmbed({
            color: COLORS.blue,
            title: 'Role Updated',
            headline: `The role <@&${newRole.id}> was updated.`,
            lines: [line('Updated by', actorText(entry)), '', '**Changes**', ...changes],
            footer: [`Time: ${stamp(new Date(), 'f')}`, `Role \`${newRole.id}\``],
        });
        await logs.send(newRole.guild, 'roles', { embeds: [embed] });
    },
};
