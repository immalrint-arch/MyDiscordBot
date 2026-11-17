const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleMemberCountCommand } = require('../../growth/growthFlow');

const channel = (o) => o.setName('channel').setDescription('The channel to rename (a locked voice channel works well)').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText, ChannelType.GuildCategory);
module.exports = {
    data: new SlashCommandBuilder().setName('membercount').setDescription('Staff: a channel whose name shows a live number, like "Members: 120".').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand((s) => s.setName('add').setDescription('Make a channel show a live number.').addChannelOption(channel)
            .addStringOption((o) => o.setName('text').setDescription('Like "Members: {members}". Also {humans} {bots} {boosts} {boostlevel} {channels} {roles}').setRequired(true).setMaxLength(90)))
        .addSubcommand((s) => s.setName('remove').setDescription('Stop updating a channel.').addChannelOption(channel))
        .addSubcommand((s) => s.setName('list').setDescription('Show all counter channels.')),
    execute: handleMemberCountCommand,
};
