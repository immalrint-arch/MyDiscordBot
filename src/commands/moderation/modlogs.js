const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { formatCaseLine } = require('../../utils/format');

const PAGE_SIZE = 10;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('modlogs')
        .setDescription("Show a user's full moderation history in this server.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('Whose history to show').setRequired(true))
        .addIntegerOption((o) => o.setName('page').setDescription('Page number (10 cases per page)').setMinValue(1)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;

        const { cases } = interaction.client.services;
        const user = interaction.options.getUser('user', true);
        const guildId = interaction.guildId;

        const total = cases.countCases(guildId, { targetId: user.id });
        if (total === 0) {
            return respond(interaction, `**${user.username}** has no moderation history here.`);
        }

        const pages = Math.ceil(total / PAGE_SIZE);
        const page = Math.min(interaction.options.getInteger('page') ?? 1, pages);
        const list = cases.listCases(guildId, {
            targetId: user.id,
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
        });

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`Moderation history · ${user.username}`)
            .setDescription(list.map(formatCaseLine).join('\n'))
            .setFooter({ text: `Page ${page} of ${pages} · ${total} case(s) · use /case for details` });

        return interaction.reply({
            embeds: [embed],
            allowedMentions: { parse: [] },
        });
    },
};
