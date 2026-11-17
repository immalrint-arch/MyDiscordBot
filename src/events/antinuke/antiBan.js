const { Events, AuditLogEvent } = require('discord.js');

module.exports = {
    name: Events.GuildBanAdd,
    async execute(ban) {
        const { antinuke } = ban.client.services;
        if (!antinuke.isEnabled(ban.guild.id)) return;
        await antinuke.handleSignal(ban.guild, {
            rule: 'memberBan',
            targetId: ban.user.id,
            targetName: ban.user.username,
            auditType: AuditLogEvent.MemberBanAdd,
        });
    },
};
