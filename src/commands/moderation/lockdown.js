const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason } = require('../../utils/text');
const { actionLogEmbed } = require('../../utils/embeds');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { MAX_CHANNELS } = require('../../services/lockdownService');

const CONFIRM_MS = 60 * 1000;
const pending = new Map(); // "guild:user" -> { reason, expires }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('EMERGENCY: stop @everyone from chatting in every text channel (needs confirmation).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addStringOption((o) => o.setName('reason').setDescription('Why the server is being locked').setMaxLength(512)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;

        pending.set(`${interaction.guildId}:${interaction.user.id}`, {
            reason: cleanReason(interaction.options.getString('reason')),
            expires: Date.now() + CONFIRM_MS,
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`lk:go:${interaction.user.id}`).setLabel('Lock the server').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`lk:no:${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );
        return interaction.reply({
            content:
                `⚠️ **This will stop @everyone from sending messages in up to ${MAX_CHANNELS} text channels.** ` +
                'It can be undone with `/unlockdown`. Confirm within 60 seconds.',
            components: [row],
        });
    },

    // Called when someone presses "Lock the server" or "Cancel" (see index.js).
    async handleComponent(interaction) {
        const [, action, ownerId] = interaction.customId.split(':');
        if (interaction.user.id !== ownerId) {
            return interaction.reply({ content: 'This confirmation belongs to someone else.' });
        }
        const key = `${interaction.guildId}:${interaction.user.id}`;
        const request = pending.get(key);
        pending.delete(key);

        if (action === 'no') return interaction.update({ content: 'Cancelled. Nothing was changed.', components: [] });
        if (!request || request.expires < Date.now()) {
            return interaction.update({ content: 'That confirmation expired. Run `/lockdown` again.', components: [] });
        }
        // Check the permission again at the moment of the click.
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.update({ content: 'You no longer have the **Manage Channels** permission.', components: [] });
        }

        await interaction.update({ content: '🔒 Locking channels… this can take a minute.', components: [] });
        try {
            const { lockdown, modLog } = interaction.client.services;
            const result = await lockdown.lockdown(interaction.guild, { moderatorId: interaction.user.id, reason: request.reason });

            await modLog.send(interaction.guild, {
                embeds: [
                    actionLogEmbed({
                        title: '🔒 Server lockdown',
                        moderatorId: interaction.user.id,
                        color: 0xe74c3c,
                        fields: [
                            { name: 'Channels locked', value: String(result.locked), inline: true },
                            { name: 'Reason', value: request.reason ?? 'No reason provided' },
                        ],
                    }),
                ],
            });

            let text = `✅ Locked **${result.locked}** channel(s). Use \`/unlockdown\` to reopen them.`;
            if (result.alreadyLocked) text += `\n${result.alreadyLocked} were already locked.`;
            if (result.skipped.length) text += `\nSkipped: ${result.skipped.slice(0, 8).join(', ')}${result.skipped.length > 8 ? '…' : ''}`;
            if (result.failed.length) text += `\n⚠️ Failed: ${result.failed.slice(0, 8).join(', ')}`;
            return interaction.editReply({ content: text });
        } catch (error) {
            logger.error(`lockdown failed in server ${interaction.guildId}:`, error);
            return interaction.editReply({ content: 'Something went wrong during the lockdown. Check the bot console.' });
        }
    },
};
