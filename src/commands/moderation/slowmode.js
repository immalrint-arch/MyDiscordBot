const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason } = require('../../utils/text');
const { actionLogEmbed } = require('../../utils/embeds');
const { respond, ensureModerator, auditReason, describeError } = require('../../moderation/helpers');
const { formatDuration } = require('../../utils/duration');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set how often people can send messages in a channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addIntegerOption((o) =>
            o
                .setName('seconds')
                .setDescription('Seconds between messages. 0 turns slowmode off (max 21600 = 6 hours)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(21600)
        )
        .addChannelOption((o) =>
            o
                .setName('channel')
                .setDescription('Which channel (default: this one)')
                .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;

        const channel = interaction.options.getChannel('channel') ?? interaction.channel;
        if (!channel || typeof channel.setRateLimitPerUser !== 'function') {
            return respond(interaction, 'Slowmode can only be set on text channels.');
        }

        await interaction.deferReply();

        const seconds = interaction.options.getInteger('seconds', true);
        const reason = cleanReason(interaction.options.getString('reason'));

        try {
            const me = await interaction.guild.members.fetchMe();
            if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
                return respond(interaction, `In ${channel} I need **View Channel** and **Manage Channels**.`);
            }

            interaction.client.services.suppress.mark(interaction.guildId, 'channel-update', channel.id);
            await channel.setRateLimitPerUser(seconds, auditReason(interaction, reason));

            await interaction.client.services.modLog.send(interaction.guild, {
                embeds: [
                    actionLogEmbed({
                        title: seconds === 0 ? 'Slowmode disabled' : 'Slowmode enabled',
                        moderatorId: interaction.user.id,
                        fields: [
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Delay', value: seconds === 0 ? 'Off' : formatDuration(seconds * 1000), inline: true },
                            { name: 'Reason', value: reason ?? 'No reason provided' },
                        ],
                    }),
                ],
            });

            return respond(
                interaction,
                seconds === 0
                    ? `✅ Slowmode turned off in ${channel}.`
                    : `✅ Slowmode in ${channel} set to **${formatDuration(seconds * 1000)}**.`
            );
        } catch (error) {
            logger.error(`slowmode failed in server ${interaction.guildId}:`, error);
            return respond(interaction, `I couldn't change slowmode: ${describeError(error)}.`);
        }
    },
};
