const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { actionLogEmbed, undoResultEmbed } = require('../../utils/embeds');
const { cleanReason } = require('../../utils/text');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unwarn')
        .setDescription('Pardon a warning. It stays in the history but no longer counts as active.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addIntegerOption((o) =>
            o.setName('case_number').setDescription('The case number of the warning').setRequired(true).setMinValue(1)
        )
        .addStringOption((o) =>
            o.setName('reason').setDescription('Why it is being pardoned').setMaxLength(512)
        ),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;

        const { cases, modLog } = interaction.client.services;
        const number = interaction.options.getInteger('case_number', true);
        const reason = cleanReason(interaction.options.getString('reason'));

        const found = cases.getCase(interaction.guildId, number);
        if (!found || found.type !== 'warn') {
            return respond(interaction, `Case #${number} is not a warning in this server.`);
        }
        if (!cases.deactivateWarning(interaction.guildId, number)) {
            return respond(interaction, `Warning #${number} has already been pardoned.`);
        }

        await modLog.send(interaction.guild, {
            embeds: [
                actionLogEmbed({
                    title: `Warning #${number} pardoned`,
                    moderatorId: interaction.user.id,
                    color: 0x2ecc71,
                    fields: [
                        { name: 'User', value: `<@${found.targetId}> (\`${found.targetId}\`)`, inline: true },
                        { name: 'Reason', value: reason ?? 'No reason provided' },
                    ],
                }),
            ],
        });

        const user = await interaction.client.users.fetch(found.targetId).catch(() => null);
        const embed = undoResultEmbed({
            title: 'Unwarn result:', reason: reason ?? 'No reason.', moderatorId: interaction.user.id,
            successes: [`Warning #${number} for \`${user ? user.username : found.targetId}\``],
            allDoneText: 'The warning was pardoned!',
        });
        return respond(interaction, null, { embeds: [embed] });
    },
};
