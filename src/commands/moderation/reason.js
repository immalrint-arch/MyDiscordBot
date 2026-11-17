const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { actionLogEmbed } = require('../../utils/embeds');
const { cleanReason } = require('../../utils/text');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reason')
        .setDescription('Change the reason of a case you created.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addIntegerOption((o) =>
            o.setName('case_number').setDescription('The case to edit').setRequired(true).setMinValue(1)
        )
        .addStringOption((o) =>
            o.setName('reason').setDescription('The new reason').setRequired(true).setMaxLength(512)
        ),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;

        const { cases, modLog } = interaction.client.services;
        const number = interaction.options.getInteger('case_number', true);
        const newReason = cleanReason(interaction.options.getString('reason', true));
        if (!newReason) {
            return respond(interaction, 'The reason cannot be empty.');
        }

        const found = cases.getCase(interaction.guildId, number);
        if (!found) {
            return respond(interaction, `There is no case #${number} in this server.`);
        }

        // Only the moderator who made the case (or someone with Manage Server)
        // may rewrite it, so evidence cannot be quietly changed by anyone else.
        const isAuthor = found.moderatorId === interaction.user.id;
        const isManager = interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
        if (!isAuthor && !isManager) {
            return respond(interaction, 'Only the moderator who created this case, or someone with **Manage Server**, can edit it.');
        }

        cases.updateReason(interaction.guildId, number, newReason);

        // The log keeps the OLD reason too, so every change stays traceable.
        await modLog.send(interaction.guild, {
            embeds: [
                actionLogEmbed({
                    title: `Case #${number} reason edited`,
                    moderatorId: interaction.user.id,
                    fields: [
                        { name: 'Old reason', value: found.reason ?? 'No reason provided' },
                        { name: 'New reason', value: newReason },
                    ],
                }),
            ],
        });

        return respond(interaction, `✅ Updated the reason of case #${number}.`);
    },
};
