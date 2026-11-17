const { SlashCommandBuilder } = require('discord.js');
const { handleVoiceTimeCommand } = require('../../voicetime/voiceTimeFlow');

const user = (o, req = false) => o.setName('user').setDescription('The member').setRequired(req);
module.exports = {
    data: new SlashCommandBuilder().setName('voicetime').setDescription('How long people have spent in voice channels, and the top talkers.').setDMPermission(false)
        .addSubcommand((s) => s.setName('stats').setDescription('Show voice time (yours, or another member\'s).').addUserOption((o) => user(o)))
        .addSubcommand((s) => s.setName('top').setDescription('The members with the most voice time.')
            .addStringOption((o) => o.setName('period').setDescription('Which board (default: all time)').addChoices({ name: 'All time', value: 'all' }, { name: 'Today', value: 'daily' }, { name: 'This week', value: 'weekly' }, { name: 'This month', value: 'monthly' }))
            .addBooleanOption((o) => o.setName('previous').setDescription('Show the previous day, week or month (not for all time)')))
        .addSubcommand((s) => s.setName('enable').setDescription('Staff: start counting voice time.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Staff: stop counting (numbers are kept).'))
        .addSubcommand((s) => s.setName('reset').setDescription('Staff: erase one member\'s voice time.').addUserOption((o) => user(o, true))),
    execute: handleVoiceTimeCommand,
};
