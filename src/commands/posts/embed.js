const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleEmbedCommand } = require('../../posts/postFlow');
const R = require('../../posts/rules');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const channel = (o, what = 'Where to post it') => o.setName('channel').setDescription(what).setRequired(true).addChannelTypes(...TEXT_CHANNELS);
const fields = (s, required = false) => s
    .addStringOption((o) => o.setName('title').setDescription('The big heading').setMaxLength(R.MAX_TITLE))
    .addStringOption((o) => o.setName('description').setDescription('The main text. Use \\n for a new line.').setMaxLength(R.MAX_DESCRIPTION).setRequired(required))
    .addStringOption((o) => o.setName('color').setDescription('A colour like #5865F2, or red, green, blue, gold...').setMaxLength(20))
    .addStringOption((o) => o.setName('footer').setDescription('Small text at the bottom').setMaxLength(R.MAX_FOOTER))
    .addStringOption((o) => o.setName('image').setDescription('A big picture (a link starting with https://)').setMaxLength(500))
    .addStringOption((o) => o.setName('thumbnail').setDescription('A small picture in the corner (https:// link)').setMaxLength(500));

module.exports = {
    data: new SlashCommandBuilder().setName('embed').setDescription('Staff: send or edit a nice announcement (embed).').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand((s) => fields(s.setName('send').setDescription('Send an embed to a channel.').addChannelOption((o) => channel(o))
            .addStringOption((o) => o.setName('content').setDescription('Plain text above the embed (optional)').setMaxLength(R.MAX_CONTENT))
            .addRoleOption((o) => o.setName('ping').setDescription('A role to ping with it (optional)'))))
        .addSubcommand((s) => s.setName('form').setDescription('Write a long announcement in a form.').addChannelOption((o) => channel(o)))
        .addSubcommand((s) => fields(s.setName('edit').setDescription('Change an embed I posted earlier.').addStringOption((o) => o.setName('message_link').setDescription('Right-click the message, then Copy Message Link').setRequired(true).setMaxLength(200)))),
    execute: handleEmbedCommand,
};
