const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleStickyCommand } = require('../../posts/postFlow');
const R = require('../../posts/rules');

const channel = (o) => o.setName('channel').setDescription('The channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
module.exports = {
    data: new SlashCommandBuilder().setName('sticky').setDescription('Staff: keep a message at the bottom of a channel.').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand((s) => s.setName('set').setDescription('Make a message stick to the bottom of a channel.').addChannelOption(channel)
            .addStringOption((o) => o.setName('text').setDescription('What it says. Use \\n for a new line.').setRequired(true).setMaxLength(R.MAX_DESCRIPTION))
            .addStringOption((o) => o.setName('title').setDescription('Heading (embed style only)').setMaxLength(R.MAX_TITLE))
            .addStringOption((o) => o.setName('color').setDescription('Colour like #5865F2 or red (embed style only)').setMaxLength(20))
            .addStringOption((o) => o.setName('style').setDescription('Embed (default) or plain text').addChoices({ name: 'Embed', value: 'embed' }, { name: 'Plain text', value: 'plain' })))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove the sticky message from a channel.').addChannelOption(channel))
        .addSubcommand((s) => s.setName('list').setDescription('Show all sticky messages.')),
    execute: handleStickyCommand,
};
