const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason } = require('../../utils/text');
const { actionLogEmbed } = require('../../utils/embeds');
const { respond, ensureModerator, describeError } = require('../../moderation/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete recent messages in this channel (optionally only from one user).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addIntegerOption((o) =>
            o
                .setName('amount')
                .setDescription('How many messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user'))
        .addStringOption((o) => o.setName('reason').setDescription('Why (saved in the log)').setMaxLength(512)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageMessages, 'Manage Messages'))) return;

        const channel = interaction.channel;
        if (!channel || typeof channel.bulkDelete !== 'function') {
            return respond(interaction, 'I can only purge messages in server text channels.');
        }

        await interaction.deferReply();

        const amount = interaction.options.getInteger('amount', true);
        const target = interaction.options.getUser('user');
        const reason = cleanReason(interaction.options.getString('reason'));

        try {
            const me = await interaction.guild.members.fetchMe();
            const needed = [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
            ];
            if (!channel.permissionsFor(me)?.has(needed)) {
                return respond(
                    interaction,
                    'In this channel I need **View Channel**, **Read Message History** and **Manage Messages**.'
                );
            }

            // Look at the 100 newest messages, then keep only the ones we want.
            // Pinned messages are ALWAYS skipped so important posts survive a purge.
            const fetched = await channel.messages.fetch({ limit: 100 });
            let candidates = [...fetched.values()].filter((message) => !message.pinned);
            if (target) {
                candidates = candidates.filter((message) => message.author.id === target.id);
            }
            candidates = candidates.slice(0, amount);

            if (candidates.length === 0) {
                return respond(interaction, 'There were no matching messages to delete (pinned messages are always skipped).');
            }

            // The "true" tells Discord.js to skip messages older than 14 days,
            // because Discord refuses to bulk delete those.
            interaction.client.services.suppress.mark(interaction.guildId, 'purge', channel.id);
            const deleted = await channel.bulkDelete(candidates, true);
            const count = deleted.size;

            if (count === 0) {
                return respond(interaction, 'Those messages are older than 14 days, and Discord does not allow bulk deleting them.');
            }

            const fields = [
                { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                { name: 'Deleted', value: String(count), inline: true },
            ];
            if (target) fields.push({ name: 'Only from', value: `<@${target.id}>`, inline: true });
            fields.push({ name: 'Reason', value: reason ?? 'No reason provided' });
            await interaction.client.services.modLog.send(interaction.guild, {
                embeds: [actionLogEmbed({ title: 'Messages purged', moderatorId: interaction.user.id, fields })],
            });

            let text = `✅ Deleted **${count}** message(s).`;
            if (count < candidates.length) {
                text += `\n${candidates.length - count} were older than 14 days and could not be deleted.`;
            }
            return respond(interaction, text);
        } catch (error) {
            logger.error(`purge failed in server ${interaction.guildId}:`, error);
            return respond(interaction, `I couldn't purge messages: ${describeError(error)}.`);
        }
    },
};
