const { Events } = require('discord.js');
const { COLORS, logEmbed, messageButton } = require('../logging/style');
const { quoteBlock, stamp } = require('../logging/textFormat');

// Reference image 13: "Message edited" (before and after).
module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
        if (!newMessage.guild) return;
        if (newMessage.author?.bot) return; // bots edit their own messages constantly
        // Without the old text there is nothing to compare. Link previews also trigger this event.
        if (oldMessage.partial || newMessage.partial) return;
        if (oldMessage.content === newMessage.content) return;

        const { logs } = newMessage.client.services;
        const embed = logEmbed({
            color: COLORS.blue,
            title: 'Message Edited',
            headline: `Message by <@${newMessage.author.id}> in <#${newMessage.channelId}> was edited.`,
            lines: ['**Before**', quoteBlock(oldMessage.content, 900), '', '**After**', quoteBlock(newMessage.content, 900)],
            footer: [`Time: ${stamp(new Date(), 'f')}`, `Message \`${newMessage.id}\` · User \`${newMessage.author.id}\``],
        });

        await logs.send(newMessage.guild, 'messages', { embeds: [embed], components: [messageButton(newMessage.url)] }, {
            channelId: newMessage.channelId,
            userId: newMessage.author.id,
        });
    },
};
