const { Events, AuditLogEvent } = require('discord.js');

// Anti-nuke: counts channel deletions, and saves the channel's structure for recovery.
module.exports = {
    name: Events.ChannelDelete,
    async execute(channel) {
        if (!channel.guild) return;
        const { antinuke } = channel.client.services;
        if (!antinuke.isEnabled(channel.guild.id)) return;
        await antinuke.handleSignal(channel.guild, {
            rule: 'channelDelete',
            targetId: channel.id,
            targetName: `#${channel.name}`,
            auditType: AuditLogEvent.ChannelDelete,
            snapshot: { kind: 'channel', original: channel },
        });
    },
};
