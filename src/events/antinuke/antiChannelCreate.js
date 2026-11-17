const { Events, AuditLogEvent } = require('discord.js');

module.exports = {
    name: Events.ChannelCreate,
    async execute(channel) {
        if (!channel.guild) return;
        const { antinuke } = channel.client.services;
        if (!antinuke.isEnabled(channel.guild.id)) return;
        await antinuke.handleSignal(channel.guild, {
            rule: 'channelCreate',
            targetId: channel.id,
            targetName: `#${channel.name}`,
            auditType: AuditLogEvent.ChannelCreate,
        });
    },
};
