const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runMemberAction } = require('../../moderation/runMemberAction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Remove a timeout from a member early.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member to release').setRequired(true))
        .addStringOption((o) =>
            o.setName('reason').setDescription('Why the timeout is being removed').setMaxLength(512)
        ),

    async execute(interaction) {
        await runMemberAction(interaction, {
            type: 'untimeout',
            pastTense: 'Removed the timeout of',
            resultKind: 'undo',
            resultTitle: 'Untimeout result:',
            actionLabel: 'remove the timeout of',
            userPermission: PermissionFlagsBits.ModerateMembers,
            userPermissionLabel: 'Timeout Members',
            botPermission: PermissionFlagsBits.ModerateMembers,
            botPermissionLabel: 'Timeout Members',
            apiFlag: 'moderatable',
            dm: 'none',
            precheck: (member) =>
                member.isCommunicationDisabled() ? null : 'That member is not currently timed out.',
            perform: ({ member, auditReason }) => member.timeout(null, auditReason), // null removes it
        });
    },
};
