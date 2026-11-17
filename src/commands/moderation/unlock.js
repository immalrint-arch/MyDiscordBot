const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason } = require('../../utils/text');
const { actionLogEmbed } = require('../../utils/embeds');
const { respond, ensureModerator, auditReason, describeError } = require('../../moderation/helpers');

// How to put "Send Messages" back, based on what it was before /lock.
// true = explicitly allowed, false = explicitly denied, null = back to the default.
const RESTORE_VALUE = { allow: true, deny: false, neutral: null };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Reopen a channel that was closed with /lock.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addChannelOption((o) =>
            o
                .setName('channel')
                .setDescription('Which channel (default: this one)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;

        const channel = interaction.options.getChannel('channel') ?? interaction.channel;
        if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
            return respond(interaction, 'I can only unlock server text channels.');
        }

        await interaction.deferReply();

        const { guild } = interaction;
        const { channelLocks, modLog } = interaction.client.services;
        const reason = cleanReason(interaction.options.getString('reason'));

        try {
            // We only reopen channels that /lock closed, so we never accidentally
            // open a channel that is read-only on purpose (like an announcements channel).
            const lock = channelLocks.getLock(guild.id, channel.id);
            if (!lock) {
                return respond(interaction, `${channel} was not locked with /lock, so I will not change it.`);
            }

            const me = await guild.members.fetchMe();
            const needed = [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageRoles,
            ];
            if (!channel.permissionsFor(me)?.has(needed)) {
                return respond(interaction, `In ${channel} I need **View Channel**, **Manage Channels** and **Manage Permissions**.`);
            }

            interaction.client.services.suppress.mark(guild.id, 'channel-update', channel.id);
            await channel.permissionOverwrites.edit(
                guild.roles.everyone,
                { SendMessages: RESTORE_VALUE[lock.previousState] },
                { reason: auditReason(interaction, reason) }
            );
            channelLocks.clearLock(guild.id, channel.id);

            await channel.send('🔓 This channel has been unlocked.').catch(() => {});

            await modLog.send(guild, {
                embeds: [
                    actionLogEmbed({
                        title: 'Channel unlocked',
                        moderatorId: interaction.user.id,
                        color: 0x2ecc71,
                        fields: [
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Reason', value: reason ?? 'No reason provided' },
                        ],
                    }),
                ],
            });

            return respond(interaction, `✅ Unlocked ${channel}.`);
        } catch (error) {
            logger.error(`unlock failed in server ${interaction.guildId}:`, error);
            return respond(interaction, `I couldn't unlock that channel: ${describeError(error)}.`);
        }
    },
};
