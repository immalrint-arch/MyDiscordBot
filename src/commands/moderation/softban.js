const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runMemberAction } = require('../../moderation/runMemberAction');
const { UserFacingError } = require('../../moderation/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('softban')
        .setDescription('Ban and instantly unban a member to delete their recent messages.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member to softban').setRequired(true))
        .addStringOption((o) =>
            o.setName('reason').setDescription('Why they are being softbanned').setMaxLength(512)
        )
        .addIntegerOption((o) =>
            o
                .setName('delete_days')
                .setDescription('Delete their messages from the last N days (1-7, default 1)')
                .setMinValue(1)
                .setMaxValue(7)
        ),

    async execute(interaction) {
        const deleteDays = interaction.options.getInteger('delete_days') ?? 1;

        await runMemberAction(interaction, {
            type: 'softban',
            pastTense: 'Softbanned',
            resultTitle: 'Softban Result:',
            resultListTitle: 'Softbanned:',
            actionLabel: 'softban',
            userPermission: PermissionFlagsBits.BanMembers,
            userPermissionLabel: 'Ban Members',
            botPermission: PermissionFlagsBits.BanMembers,
            botPermissionLabel: 'Ban Members',
            apiFlag: 'bannable',
            dm: 'before',
            perform: async ({ guild, user, auditReason }) => {
                await guild.members.ban(user.id, {
                    reason: auditReason,
                    deleteMessageSeconds: deleteDays * 24 * 60 * 60,
                });
                try {
                    await guild.members.unban(user.id, `Softban: ${auditReason}`.slice(0, 512));
                } catch {
                    // The ban worked but the unban did not. Tell the moderator clearly.
                    throw new UserFacingError(
                        'they were banned, but the automatic unban failed. Please unban them manually with /unban'
                    );
                }
            },
        });
    },
};
