const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runMemberAction } = require('../../moderation/runMemberAction');
const { respond } = require('../../moderation/helpers');
const { cleanReason } = require('../../utils/text');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('note')
        .setDescription('Add a private staff note about a member. They are never told about it.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member the note is about').setRequired(true))
        .addStringOption((o) =>
            o.setName('note').setDescription('What staff should know').setRequired(true).setMaxLength(512)
        ),

    async execute(interaction) {
        const note = cleanReason(interaction.options.getString('note', true));
        if (!note) {
            return respond(interaction, 'The note cannot be empty.');
        }

        await runMemberAction(interaction, {
            type: 'note',
            pastTense: 'Added a note about',
            actionLabel: 'add a note about',
            userPermission: PermissionFlagsBits.ModerateMembers,
            userPermissionLabel: 'Timeout Members',
            botMustOutrank: false,
            dm: 'none', // notes are private to staff
            reason: note, // the note text is stored in the "reason" column
        });
    },
};
