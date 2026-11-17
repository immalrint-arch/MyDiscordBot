const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runMemberAction } = require('../../moderation/runMemberAction');
const { runEscalation } = require('../../moderation/escalationFlow');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Give a member an official warning (saved as a case).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member to warn').setRequired(true))
        .addStringOption((o) =>
            o.setName('reason').setDescription('Why they are being warned').setRequired(true).setMaxLength(512)
        ),

    async execute(interaction) {
        await runMemberAction(interaction, {
            type: 'warn',
            pastTense: 'Warned',
            resultTitle: 'Warn Result:',
            resultListTitle: 'Warned:',
            actionLabel: 'warn',
            userPermission: PermissionFlagsBits.ModerateMembers,
            userPermissionLabel: 'Timeout Members',
            botMustOutrank: false, // a warning is only a record, so the bot's role does not matter
            dm: 'after',
            // No "perform": a warning does not change anything on Discord itself.
            afterAction: (ctx) => runEscalation(interaction, ctx), // /warnescalation: automatic timeout/kick/ban at a number of warnings
        });
    },
};
