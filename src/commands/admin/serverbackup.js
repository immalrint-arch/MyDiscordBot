const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleBackupCommand } = require('../../serverbackup/backupFlow');

const id = (o) => o.setName('id').setDescription('Backup number from /serverbackup list').setRequired(true).setMinValue(1);
module.exports = {
    data: new SlashCommandBuilder().setName('serverbackup').setDescription('Save and restore your roles, channels and permissions.').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((s) => s.setName('create').setDescription('Save a backup of the roles, channels and permissions now.').addStringOption((o) => o.setName('name').setDescription('A name for this backup').setMaxLength(60)))
        .addSubcommand((s) => s.setName('list').setDescription('Show your saved backups.'))
        .addSubcommand((s) => s.setName('info').setDescription('See what is inside a backup.').addIntegerOption(id))
        .addSubcommand((s) => s.setName('restore').setDescription('Put back what is missing from a backup (nothing is deleted).').addIntegerOption(id)
            .addBooleanOption((o) => o.setName('fix_existing').setDescription('Also put the saved permissions back on roles and channels that still exist'))
            .addBooleanOption((o) => o.setName('settings').setDescription('Also put back the server name, verification level and similar settings')))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a backup.').addIntegerOption(id))
        .addSubcommand((s) => s.setName('auto').setDescription('Save a backup automatically every few days.').addIntegerOption((o) => o.setName('days').setDescription('Every how many days (1-30), or 0 to turn off').setRequired(true).setMinValue(0).setMaxValue(30))),
    execute: handleBackupCommand,
};
