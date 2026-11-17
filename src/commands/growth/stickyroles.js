const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleStickyRolesCommand } = require('../../growth/growthFlow');

module.exports = {
    data: new SlashCommandBuilder().setName('stickyroles').setDescription('Staff: give members their roles back when they rejoin.').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) => s.setName('enable').setDescription('Turn sticky roles on.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn sticky roles off.'))
        .addSubcommand((s) => s.setName('status').setDescription('Show whether sticky roles are on.'))
        .addSubcommand((s) => s.setName('forget').setDescription('Delete the saved roles of one member.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))),
    execute: handleStickyRolesCommand,
};
