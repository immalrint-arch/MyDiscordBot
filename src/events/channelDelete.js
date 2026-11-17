const { Events, AuditLogEvent, ChannelType } = require('discord.js');
const { COLORS, logEmbed, actorText } = require('../logging/style');
const { line, readableChannelType, stamp } = require('../logging/textFormat');

// Reference image 12: "Channel Deleted". (No "Open Channel" button: the channel is gone.)
module.exports = {
    name: Events.ChannelDelete,
    async execute(channel) {
        if (!channel.guild) return;
        const { logs, audit } = channel.client.services;

        const entry = await audit.findEntry(channel.guild, AuditLogEvent.ChannelDelete, { targetId: channel.id });
        const type = readableChannelType(ChannelType[channel.type]);
        const embed = logEmbed({
            color: COLORS.red,
            title: 'Channel Deleted',
            headline: `The ${type.toLowerCase()} channel **#${channel.name}** was deleted.`,
            lines: [line('Type', type), line('Deleted by', actorText(entry))],
            footer: [`Time: ${stamp(new Date(), 'f')}`, `Channel \`${channel.id}\``],
        });
        await logs.send(channel.guild, 'channels', { embeds: [embed] });
    },
};
