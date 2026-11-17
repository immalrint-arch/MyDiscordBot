const { Events, AuditLogEvent } = require('discord.js');

// A new bot joining is a classic attack route, so it is always worth an alert.
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        if (!member.user.bot) return;
        const { antinuke } = member.client.services;
        if (!antinuke.isEnabled(member.guild.id)) return;
        await antinuke.handleSignal(member.guild, {
            rule: 'botAdd',
            targetId: member.user.id,
            targetName: `🤖 ${member.user.username}`,
            auditType: AuditLogEvent.BotAdd,
        });
    },
};
