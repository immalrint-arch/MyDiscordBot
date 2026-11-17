const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { StarboardServiceError } = require('../../services/starboardService');

const PERM = PermissionFlagsBits.ManageGuild;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('starboard')
        .setDescription('Show popular messages in a special channel.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('setup').setDescription('Turn the starboard on, or change it.')
            .addChannelOption((o) => o.setName('channel').setDescription('Where popular messages are shown').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addIntegerOption((o) => o.setName('stars').setDescription('How many reactions are needed (default 3)').setMinValue(1).setMaxValue(50))
            .addStringOption((o) => o.setName('emoji').setDescription('Which emoji counts (default ⭐)').setMaxLength(60)))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn the starboard off.'))
        .addSubcommand((s) => s.setName('status').setDescription('Show the starboard settings.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const { starboard } = interaction.client.services;
        const { guild } = interaction;
        try {
            switch (interaction.options.getSubcommand()) {
                case 'setup': {
                    const channel = interaction.options.getChannel('channel', true);
                    const me = await guild.members.fetchMe();
                    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return respond(interaction, `I need View Channel, Send Messages and Embed Links in <#${channel.id}>.`);
                    starboard.setup(guild.id, { channelId: channel.id, threshold: interaction.options.getInteger('stars'), emoji: interaction.options.getString('emoji') });
                    const c = starboard.getConfig(guild.id);
                    return respond(interaction, `✅ Starboard is on in <#${channel.id}>. A message needs **${c.threshold}** ${c.emoji} reactions (the author's own and bots' do not count).`);
                }
                case 'disable': starboard.setup(guild.id, { channelId: null }); return respond(interaction, '⛔ The starboard is off. Existing starboard posts stay.');
                default: {
                    const c = starboard.getConfig(guild.id);
                    return respond(interaction, ['**Starboard**', `Channel: ${c.channelId ? `<#${c.channelId}>` : 'not set (off)'}`, `Needs: ${c.threshold} × ${c.emoji}`, `Posts so far: ${starboard.countPosts(guild.id)}`].join('\n'));
                }
            }
        } catch (error) {
            if (error instanceof StarboardServiceError) return respond(interaction, `⚠️ ${error.message}`);
            throw error;
        }
    },
};
