const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { caseEmbed } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('case')
        .setDescription('Look up one moderation case by its number.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addIntegerOption((o) =>
            o.setName('number').setDescription('The case number, e.g. 12').setRequired(true).setMinValue(1)
        ),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;

        const number = interaction.options.getInteger('number', true);
        const found = interaction.client.services.cases.getCase(interaction.guildId, number);
        if (!found) {
            return respond(interaction, `There is no case #${number} in this server.`);
        }

        const { client } = interaction;
        const [target, moderator] = await Promise.all([
            client.users.fetch(found.targetId).catch(() => null),
            client.users.fetch(found.moderatorId).catch(() => null),
        ]);

        return interaction.reply({
            embeds: [caseEmbed(found, { target, moderator })],
            allowedMentions: { parse: [] },
        });
    },
};
