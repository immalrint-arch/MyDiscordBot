const { Events } = require('discord.js');
const { COLORS, logEmbed } = require('../logging/style');
const { line, stamp } = require('../logging/textFormat');

module.exports = {
    name: Events.MessageBulkDelete,
    async execute(messages, channel) {
        if (!channel.guild) return;
        const { logs, suppress } = channel.client.services;

        // Our own /purge already logged this.
        if (suppress.isSuppressed(channel.guild.id, 'purge', channel.id)) return;

        const embed = logEmbed({
            color: COLORS.red,
            title: 'Messages Bulk Deleted',
            headline: `**${messages.size}** messages were deleted at once in <#${channel.id}>.`,
            lines: [line('Messages we still had in memory', [...messages.values()].filter((m) => !m.partial).length)],
            footer: [`Time: ${stamp(new Date(), 'f')}`, `Channel \`${channel.id}\``],
        });
        await logs.send(channel.guild, 'messages', { embeds: [embed] }, { channelId: channel.id });
    },
};
