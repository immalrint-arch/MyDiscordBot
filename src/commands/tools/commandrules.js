const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleCommandRulesCommand, autocompleteCommandName } = require('../../access/accessFlow');

const command = (o) => o.setName('command').setDescription('The command, like ban or play (start typing)').setRequired(true).setAutocomplete(true).setMaxLength(32);
const mode = (o, what) => o.setName('mode').setDescription(what).setRequired(true).addChoices({ name: 'Allow', value: 'allow' }, { name: 'Block', value: 'deny' }, { name: 'Remove this rule', value: 'remove' });
module.exports = {
    data: new SlashCommandBuilder().setName('commandrules').setDescription('Staff: choose who can use a command, and where.').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) => s.setName('role').setDescription('Allow or block a role for a command.').addStringOption(command).addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)).addStringOption((o) => mode(o, 'Allow only this role, block it, or remove the rule')))
        .addSubcommand((s) => s.setName('channel').setDescription('Allow or block a channel for a command.').addStringOption(command)
            .addChannelOption((o) => o.setName('channel').setDescription('A channel or category').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildForum, ChannelType.GuildCategory))
            .addStringOption((o) => mode(o, 'Allow only here, block here, or remove the rule')))
        .addSubcommand((s) => s.setName('disable').setDescription('Switch a command off in this server.').addStringOption(command))
        .addSubcommand((s) => s.setName('enable').setDescription('Switch a command back on.').addStringOption(command))
        .addSubcommand((s) => s.setName('clear').setDescription('Remove every rule of a command.').addStringOption(command))
        .addSubcommand((s) => s.setName('list').setDescription('Show all command rules.')),
    execute: handleCommandRulesCommand,
    autocomplete: autocompleteCommandName,
};
