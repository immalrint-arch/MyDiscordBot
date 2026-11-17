const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { respond } = require('../../moderation/helpers');
const { buildLeaderboardPayload } = require('../../leveling/levelFlow');

const PERIODS = ['all', 'daily', 'weekly', 'monthly'];

// customId: lb:<period>:<page>:<offset>:<userId>
const buttons = (period, page, offset, pages, userId) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lb:${period}:${page - 1}:${offset}:${userId}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`lb:${period}:${page + 1}:${offset}:${userId}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages),
);

async function show(interaction, period, page, offset, mode) {
    const payload = await buildLeaderboardPayload(interaction.client, interaction.guild, { period, page, offset });
    const { empty, pages, page: current, ...send } = payload;
    send.components = pages > 1 ? [buttons(period, current, offset, pages, interaction.user.id)] : [];
    if (mode === 'update') return interaction.update(send);
    return interaction.editReply(send);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show the top members by XP.')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('period').setDescription('Which board (default: all time)')
            .addChoices({ name: 'All time', value: 'all' }, { name: 'Today', value: 'daily' }, { name: 'This week', value: 'weekly' }, { name: 'This month', value: 'monthly' }))
        .addBooleanOption((o) => o.setName('previous').setDescription('Show the previous day/week/month instead (not for all time)')),
    async execute(interaction) {
        const { levels } = interaction.client.services;
        if (!levels.getConfig(interaction.guild.id).enabled) return respond(interaction, 'Leveling is not turned on in this server.');
        const period = interaction.options.getString('period') ?? 'all';
        const offset = period !== 'all' && interaction.options.getBoolean('previous') ? -1 : 0;
        await interaction.deferReply();
        return show(interaction, period, 1, offset, 'edit');
    },
    // Page buttons.
    async handleComponent(interaction) {
        const [, period, page, offset, userId] = interaction.customId.split(':');
        if (interaction.user.id !== userId) return interaction.reply({ content: 'Only the person who opened this board can flip its pages. Use `/leaderboard` for your own.', flags: MessageFlags.Ephemeral });
        if (!PERIODS.includes(period)) return;
        return show(interaction, period, Number(page) || 1, Number(offset) || 0, 'update');
    },
};
