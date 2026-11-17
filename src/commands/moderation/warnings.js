const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { formatCaseLine } = require('../../utils/format');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription("Show a member's active warnings (pardoned ones are hidden).")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('Whose warnings to show').setRequired(true)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;

        const { cases } = interaction.client.services;
        const user = interaction.options.getUser('user', true);
        const warnings = cases.listActiveWarnings(interaction.guildId, user.id);

        if (warnings.length === 0) {
            return respond(interaction, `**${user.username}** has no active warnings.`);
        }

        const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(`Active warnings · ${user.username}`)
            .setDescription(warnings.map(formatCaseLine).join('\n'))
            .setFooter({ text: `${warnings.length} active warning(s) · /unwarn removes one` });

        return interaction.reply({
            embeds: [embed],
            allowedMentions: { parse: [] },
        });
    },
};
