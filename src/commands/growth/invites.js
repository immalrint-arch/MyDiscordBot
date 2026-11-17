const { SlashCommandBuilder } = require('discord.js');
const { handleInvitesCommand } = require('../../growth/growthFlow');

const user = (o, req = false, what = 'The member') => o.setName('user').setDescription(what).setRequired(req);
module.exports = {
    data: new SlashCommandBuilder().setName('invites').setDescription('See who invited whom: invite counts and the top inviters.').setDMPermission(false)
        .addSubcommand((s) => s.setName('stats').setDescription('Show invite numbers (yours, or another member\'s).').addUserOption((o) => user(o)))
        .addSubcommand((s) => s.setName('top').setDescription('The members who invited the most people.'))
        .addSubcommand((s) => s.setName('who').setDescription('Staff: who invited this member?').addUserOption((o) => user(o, true)))
        .addSubcommand((s) => s.setName('enable').setDescription('Staff: start tracking invites (needs my Manage Server permission).'))
        .addSubcommand((s) => s.setName('disable').setDescription('Staff: stop tracking invites (numbers are kept).'))
        .addSubcommand((s) => s.setName('reset').setDescription('Staff: erase all invite numbers.').addBooleanOption((o) => o.setName('confirm').setDescription('Set to true to really erase').setRequired(true))),
    execute: handleInvitesCommand,
};
