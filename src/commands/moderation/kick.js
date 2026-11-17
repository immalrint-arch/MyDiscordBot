const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runMemberAction } = require('../../moderation/runMemberAction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server. They can rejoin with an invite.')
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member to kick').setRequired(true))
        .addStringOption((o) =>
            o.setName('reason').setDescription('Why they are being kicked').setMaxLength(512)
        ),

    async execute(interaction) {
        await runMemberAction(interaction, {
            type: 'kick',
            pastTense: 'Kicked',
            resultTitle: 'Kick Result:',
            resultListTitle: 'Kicked:',
            actionLabel: 'kick',
            userPermission: PermissionFlagsBits.KickMembers,
            userPermissionLabel: 'Kick Members',
            botPermission: PermissionFlagsBits.KickMembers,
            botPermissionLabel: 'Kick Members',
            apiFlag: 'kickable',
            dm: 'before',
            perform: ({ member, auditReason }) => member.kick(auditReason),
        });
    },
};
