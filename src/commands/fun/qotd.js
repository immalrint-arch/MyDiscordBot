const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { handleQotdCommand } = require('../../qotd/qotdFlow');

module.exports = {
    data: new SlashCommandBuilder().setName('qotd').setDescription('A new question for the community every day.').setDMPermission(false)
        .addSubcommand((s) => s.setName('setup').setDescription('Staff: choose the channel and time for the daily question.')
            .addChannelOption((o) => o.setName('channel').setDescription('Where the question is posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
            .addStringOption((o) => o.setName('time').setDescription('Time of day, 24-hour, like 09:00 (default 09:00)').setMaxLength(5))
            .addIntegerOption((o) => o.setName('utc_offset').setDescription('Your time zone as hours from UTC, like 8 (default 0)').setMinValue(-12).setMaxValue(14))
            .addRoleOption((o) => o.setName('role').setDescription('Role to ping with each question'))
            .addBooleanOption((o) => o.setName('threads').setDescription('Open a thread for answers (default yes)'))
            .addBooleanOption((o) => o.setName('builtin').setDescription('Also use the questions that come with the bot (default yes)')))
        .addSubcommand((s) => s.setName('add').setDescription('Staff: add your own question.').addStringOption((o) => o.setName('question').setDescription('The question (10-300 characters)').setRequired(true).setMaxLength(300)))
        .addSubcommand((s) => s.setName('list').setDescription('Staff: show your own questions.').addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)))
        .addSubcommand((s) => s.setName('remove').setDescription('Staff: delete one of your questions.').addIntegerOption((o) => o.setName('id').setDescription('Question number from /qotd list').setRequired(true).setMinValue(1)))
        .addSubcommand((s) => s.setName('post').setDescription('Staff: post a question right now.'))
        .addSubcommand((s) => s.setName('enable').setDescription('Staff: turn daily questions on.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Staff: turn daily questions off.'))
        .addSubcommand((s) => s.setName('status').setDescription('Staff: show the settings.')),
    execute: handleQotdCommand,
};
