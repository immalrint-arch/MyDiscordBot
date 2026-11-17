const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason } = require('../../utils/text');
const { actionLogEmbed } = require('../../utils/embeds');
const { respond, ensureModerator, describeError } = require('../../moderation/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlockdown')
        .setDescription('End a /lockdown and restore every channel exactly as it was.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addStringOption((o) => o.setName('reason').setDescription('Why the lockdown is ending').setMaxLength(512)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;
        await interaction.deferReply();

        const reason = cleanReason(interaction.options.getString('reason'));
        try {
            const { lockdown, modLog } = interaction.client.services;
            const result = await lockdown.unlockdown(interaction.guild, { moderatorId: interaction.user.id, reason });

            await modLog.send(interaction.guild, {
                embeds: [
                    actionLogEmbed({
                        title: '🔓 Lockdown ended',
                        moderatorId: interaction.user.id,
                        color: 0x2ecc71,
                        fields: [
                            { name: 'Channels reopened', value: String(result.unlocked), inline: true },
                            { name: 'Reason', value: reason ?? 'No reason provided' },
                        ],
                    }),
                ],
            });

            if (result.unlocked === 0 && result.failed.length === 0) {
                return respond(interaction, 'There was no active lockdown. (Channels closed with `/lock` are reopened with `/unlock`.)');
            }
            let text = `✅ Reopened **${result.unlocked}** channel(s).`;
            if (result.failed.length) text += `\n⚠️ Failed: ${result.failed.slice(0, 8).join(', ')}`;
            return respond(interaction, text);
        } catch (error) {
            logger.error(`unlockdown failed in server ${interaction.guildId}:`, error);
            return respond(interaction, `I couldn't end the lockdown: ${describeError(error)}.`);
        }
    },
};
