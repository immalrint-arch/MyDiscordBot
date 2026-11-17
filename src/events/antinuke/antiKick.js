const { Events, AuditLogEvent } = require('discord.js');

// Discord sends this event for leaving, kicks and bans. Only a "kick" audit entry counts here,
// so ordinary members leaving never add up to a mass-kick alert.
module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        const { antinuke } = member.client.services;
        if (!antinuke.isEnabled(member.guild.id)) return;
        await antinuke.handleSignal(member.guild, {
            rule: 'memberKick',
            targetId: member.user.id,
            targetName: member.user.username,
            auditType: AuditLogEvent.MemberKick,
            requireEntry: true,
            attempts: 2,
        });
    },
};
