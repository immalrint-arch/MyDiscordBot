const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { handleOwnerCommand } = require('../../owner/ownerFlow');

const user = (o) => o.setName('user').setDescription('The user').setRequired(true);
module.exports = {
    data: new SlashCommandBuilder().setName('owner').setDescription('Bot owner only: backup, blacklist, server list and error alerts.').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((s) => s.setName('backup').setDescription('Save a copy of the database now.'))
        .addSubcommand((s) => s.setName('blacklist-add').setDescription('Block a user from using the bot everywhere.').addUserOption(user).addStringOption((o) => o.setName('reason').setDescription('Why (only you see this)').setMaxLength(200)))
        .addSubcommand((s) => s.setName('blacklist-remove').setDescription('Let a blocked user use the bot again.').addUserOption(user))
        .addSubcommand((s) => s.setName('blacklist-list').setDescription('Show blocked users.'))
        .addSubcommand((s) => s.setName('servers').setDescription('List the servers the bot is in.'))
        .addSubcommand((s) => s.setName('errors-set').setDescription('Send error alerts to a private channel.').addChannelOption((o) => o.setName('channel').setDescription('A private text channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand((s) => s.setName('errors-off').setDescription('Stop sending error alerts.'))
        .addSubcommand((s) => s.setName('errors-test').setDescription('Send a harmless test alert.')),
    execute: handleOwnerCommand,
};
