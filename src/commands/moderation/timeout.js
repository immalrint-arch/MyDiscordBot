const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runMemberAction } = require('../../moderation/runMemberAction');
const { respond } = require('../../moderation/helpers');
const { parseDuration } = require('../../utils/duration');

// Discord does not allow timeouts longer than 28 days.
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Temporarily stop a member from chatting, reacting, or joining voice.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member to time out').setRequired(true))
        .addStringOption((o) =>
            o
                .setName('duration')
                .setDescription('How long, e.g. 10m, 2h, 1d, 1h30m (max 28d)')
                .setRequired(true)
                .setMaxLength(20)
        )
        .addStringOption((o) =>
            o.setName('reason').setDescription('Why they are being timed out').setMaxLength(512)
        ),

    async execute(interaction) {
        const durationMs = parseDuration(interaction.options.getString('duration', true));
        if (!durationMs || durationMs > MAX_TIMEOUT_MS) {
            return respond(
                interaction,
                'That duration is not valid. Use something like `10m`, `2h`, `1d` or `1h30m`, between 1 second and 28 days.'
            );
        }

        await runMemberAction(interaction, {
            type: 'timeout',
            pastTense: 'Timed out',
            resultTitle: 'Timeout Result:',
            resultListTitle: 'Timed out:',
            actionLabel: 'time out',
            userPermission: PermissionFlagsBits.ModerateMembers,
            userPermissionLabel: 'Timeout Members',
            botPermission: PermissionFlagsBits.ModerateMembers,
            botPermissionLabel: 'Timeout Members',
            apiFlag: 'moderatable',
            durationMs,
            dm: 'after',
            perform: ({ member, auditReason }) => member.timeout(durationMs, auditReason),
        });
    },
};
