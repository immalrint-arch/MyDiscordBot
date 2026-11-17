const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../moderation/helpers');
const { buildRankPayload } = require('../../leveling/levelFlow');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Show your level and XP (or someone else\'s).')
        .setDMPermission(false)
        .addUserOption((o) => o.setName('member').setDescription('Another member')),
    async execute(interaction) {
        const { levels } = interaction.client.services;
        if (!levels.getConfig(interaction.guild.id).enabled) return respond(interaction, 'Leveling is not turned on in this server.');
        const user = interaction.options.getUser('member') ?? interaction.user;
        if (user.bot) return respond(interaction, 'Bots do not earn XP.');
        await interaction.deferReply();
        const payload = await buildRankPayload(interaction.client, interaction.guild, user);
        return interaction.editReply(payload);
    },
};
