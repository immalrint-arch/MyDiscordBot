const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleScheduleCommand } = require('../../posts/postFlow');
const R = require('../../posts/rules');

module.exports = {
    data: new SlashCommandBuilder().setName('schedule').setDescription('Staff: post a message later, or on repeat.').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) => s.setName('add').setDescription('Schedule a message or embed.')
            .addChannelOption((o) => o.setName('channel').setDescription('Where to post it').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addStringOption((o) => o.setName('when').setDescription('Like 2h or 1d12h from now, or a date: 2026-12-25 09:00').setRequired(true).setMaxLength(40))
            .addStringOption((o) => o.setName('message').setDescription('Plain text to post. Use \\n for a new line.').setMaxLength(R.MAX_CONTENT))
            .addStringOption((o) => o.setName('title').setDescription('Embed heading (optional)').setMaxLength(R.MAX_TITLE))
            .addStringOption((o) => o.setName('description').setDescription('Embed text (optional)').setMaxLength(R.MAX_DESCRIPTION))
            .addStringOption((o) => o.setName('color').setDescription('Embed colour like #5865F2 or red').setMaxLength(20))
            .addStringOption((o) => o.setName('image').setDescription('Embed picture (https:// link)').setMaxLength(500))
            .addStringOption((o) => o.setName('repeat').setDescription('Post again every... like 12h, 1d or 1w (at least 10m)').setMaxLength(20))
            .addIntegerOption((o) => o.setName('times').setDescription('Stop after this many posts (with repeat)').setMinValue(1).setMaxValue(R.MAX_RUNS))
            .addRoleOption((o) => o.setName('ping').setDescription('A role to ping (optional)'))
            .addIntegerOption((o) => o.setName('utc-offset').setDescription('Your time zone for a date, like 8 for UTC+8 (default 0)').setMinValue(-12).setMaxValue(14)))
        .addSubcommand((s) => s.setName('list').setDescription('Show all scheduled posts.'))
        .addSubcommand((s) => s.setName('remove').setDescription('Delete a scheduled post.').addIntegerOption((o) => o.setName('id').setDescription('The number from /schedule list').setRequired(true).setMinValue(1)))
        .addSubcommand((s) => s.setName('toggle').setDescription('Pause or resume a scheduled post.').addIntegerOption((o) => o.setName('id').setDescription('The number from /schedule list').setRequired(true).setMinValue(1)).addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))),
    execute: handleScheduleCommand,
};
