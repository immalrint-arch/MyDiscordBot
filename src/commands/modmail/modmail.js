const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { handleModmailCommand } = require('../../modmail/modmailFlow');

const user = (o) => o.setName('user').setDescription('The member').setRequired(true);
module.exports = {
    data: new SlashCommandBuilder().setName('modmail').setDescription('Let members DM the bot to talk privately with staff.').setDMPermission(false)
        .addSubcommand((s) => s.setName('setup').setDescription('Staff: turn modmail on.')
            .addChannelOption((o) => o.setName('category').setDescription('Category where private channels are created').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
            .addRoleOption((o) => o.setName('staff_role').setDescription('Role that can see and answer conversations').setRequired(true))
            .addChannelOption((o) => o.setName('log_channel').setDescription('Where closed conversation transcripts go').addChannelTypes(ChannelType.GuildText).setRequired(true))
            .addBooleanOption((o) => o.setName('anonymous').setDescription('Show staff replies as "Staff" instead of their name')))
        .addSubcommand((s) => s.setName('enable').setDescription('Staff: turn modmail back on.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Staff: turn modmail off (open ones stay).'))
        .addSubcommand((s) => s.setName('status').setDescription('Staff: show the modmail settings.'))
        .addSubcommand((s) => s.setName('close').setDescription('Close the conversation in this channel.').addStringOption((o) => o.setName('reason').setDescription('Shown to the member').setMaxLength(300)))
        .addSubcommand((s) => s.setName('block').setDescription('Staff: stop a member from using modmail.').addUserOption(user).addStringOption((o) => o.setName('reason').setDescription('Why (staff only)').setMaxLength(200)))
        .addSubcommand((s) => s.setName('unblock').setDescription('Staff: let a blocked member use modmail again.').addUserOption(user))
        .addSubcommand((s) => s.setName('blocked').setDescription('Staff: list blocked members.')),
    execute: handleModmailCommand,
};
