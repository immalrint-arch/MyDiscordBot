const { Events, AuditLogEvent, ChannelType } = require('discord.js');
const { COLORS, logEmbed, channelButton, actorText } = require('../logging/style');
const { line, readableChannelType, stamp } = require('../logging/textFormat');

// Reference image 10: "Channel Created".
module.exports = {
    name: Events.ChannelCreate,
    async execute(channel) {
        if (!channel.guild) return; // ignore direct-message channels
        const { logs, audit } = channel.client.services;

        const entry = await audit.findEntry(channel.guild, AuditLogEvent.ChannelCreate, { targetId: channel.id });
        const type = readableChannelType(ChannelType[channel.type]);
        const embed = logEmbed({
            color: COLORS.green,
            title: 'Channel Created',
            headline: `A new ${type.toLowerCase()} channel, <#${channel.id}>, was created.`,
            lines: [line('Type', type), line('Created by', actorText(entry))],
            footer: [`Time: ${stamp(new Date(), 'f')}`, `Channel \`${channel.id}\``],
        });
        await logs.send(channel.guild, 'channels', { embeds: [embed], components: [channelButton(channel.guild.id, channel.id)] });
    },
};
