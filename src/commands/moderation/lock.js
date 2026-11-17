const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason } = require('../../utils/text');
const { actionLogEmbed } = require('../../utils/embeds');
const { respond, ensureModerator, auditReason, describeError } = require('../../moderation/helpers');

const LOCKABLE_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

module.exports = {
    LOCKABLE_TYPES,

    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Stop @everyone from sending messages in a channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addChannelOption((o) =>
            o
                .setName('channel')
                .setDescription('Which channel (default: this one)')
                .addChannelTypes(...LOCKABLE_TYPES)
        )
        .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;

        const channel = interaction.options.getChannel('channel') ?? interaction.channel;
        if (!channel || !LOCKABLE_TYPES.includes(channel.type)) {
            return respond(interaction, 'I can only lock server text channels.');
        }

        await interaction.deferReply();

        const { guild } = interaction;
        const { channelLocks, modLog } = interaction.client.services;
        const reason = cleanReason(interaction.options.getString('reason'));

        try {
            const me = await guild.members.fetchMe();
            const needed = [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageRoles, // Discord requires this to edit channel permissions
            ];
            if (!channel.permissionsFor(me)?.has(needed)) {
                return respond(interaction, `In ${channel} I need **View Channel**, **Manage Channels** and **Manage Permissions**.`);
            }

            if (channelLocks.getLock(guild.id, channel.id)) {
                return respond(interaction, `${channel} is already locked. Use /unlock to open it again.`);
            }

            // Remember what @everyone's "Send Messages" was BEFORE we change it.
            const everyone = guild.roles.everyone;
            const existing = channel.permissionOverwrites.cache.get(everyone.id);
            let previousState = 'neutral';
            if (existing?.allow.has(PermissionFlagsBits.SendMessages)) previousState = 'allow';
            else if (existing?.deny.has(PermissionFlagsBits.SendMessages)) previousState = 'deny';

            if (previousState === 'deny') {
                return respond(interaction, `@everyone already cannot send messages in ${channel}, so there is nothing to lock.`);
            }

            interaction.client.services.suppress.mark(guild.id, 'channel-update', channel.id);
            await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: auditReason(interaction, reason) });
            channelLocks.saveLock({
                guildId: guild.id,
                channelId: channel.id,
                previousState,
                lockedBy: interaction.user.id,
            });

            // A friendly notice in the channel itself. Failing to send it is not a problem.
            await channel.send('🔒 This channel has been locked by a moderator.').catch(() => {});

            await modLog.send(guild, {
                embeds: [
                    actionLogEmbed({
                        title: 'Channel locked',
                        moderatorId: interaction.user.id,
                        color: 0xe67e22,
                        fields: [
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Reason', value: reason ?? 'No reason provided' },
                        ],
                    }),
                ],
            });

            return respond(interaction, `✅ Locked ${channel}.`);
        } catch (error) {
            logger.error(`lock failed in server ${interaction.guildId}:`, error);
            return respond(interaction, `I couldn't lock that channel: ${describeError(error)}.`);
        }
    },
};
