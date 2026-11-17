const { Events } = require('discord.js');
const { COLORS, logEmbed } = require('../logging/style');
const { line, quoteBlock, stamp } = require('../logging/textFormat');

// Reference image 13: "Message deleted".
//
// Honest limits (Discord does not give us more):
//  - We can only show the text if the message was in the bot's memory. Messages sent while the
//    bot was offline, or very old ones, are "not cached" and we only know the channel.
//  - Discord does NOT tell us who deleted a message, so we do not guess.
//  - The text is kept only in the bot's memory (never saved in the database).
module.exports = {
    name: Events.MessageDelete,
    async execute(message) {
        if (!message.guild) return;
        const { logs } = message.client.services;
        if (message.author?.id === message.client.user.id) return; // never log our own messages

        const lines = [];
        if (message.partial || message.content === null) {
            lines.push('*The text of this message was not available (it was not cached).*');
        } else {
            lines.push(quoteBlock(message.content));
            if (message.attachments?.size) {
                lines.push('', line('Attachments', [...message.attachments.values()].map((a) => a.name).slice(0, 10).join(', ')));
            }
        }

        const who = message.author ? `<@${message.author.id}>` : 'an unknown author';
        const embed = logEmbed({
            color: COLORS.red,
            title: 'Message Deleted',
            headline: `Message by ${who} in <#${message.channelId}> was deleted:`,
            lines,
            footer: [`Time: ${stamp(new Date(), 'f')}`, `Message \`${message.id}\`${message.author ? ` · User \`${message.author.id}\`` : ''}`],
        });

        await logs.send(message.guild, 'messages', { embeds: [embed] }, {
            channelId: message.channelId,
            userId: message.author?.id ?? null,
        });
    },
};
