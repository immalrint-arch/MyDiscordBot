const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanText } = require('../../utils/text');
const { respond } = require('../../moderation/helpers');
const { ReportServiceError } = require('../../services/reportService');

const unix = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const buttons = (number, disabled = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rt:resolve:${number}`).setLabel('Resolve').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`rt:dismiss:${number}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary).setDisabled(disabled));

function reportEmbed(report, { sourceChannelId = null, target = null, reporter = null } = {}) {
    const e = new EmbedBuilder().setColor(report.status === 'open' ? 0xe67e22 : report.status === 'resolved' ? 0x2ecc71 : 0x95a5a6)
        .setTitle(`🚩 Report #${report.number}`)
        .addFields(
            { name: 'Reported member', value: `<@${report.targetId}> (\`${report.targetId}\`)`, inline: true },
            { name: 'Reported by', value: `<@${report.reporterId}>`, inline: true },
            ...(sourceChannelId ? [{ name: 'Channel', value: `<#${sourceChannelId}>`, inline: true }] : []),
            { name: 'What happened', value: report.reason.slice(0, 1000) },
        ).setTimestamp(new Date(report.createdAt));
    if (target?.displayAvatarURL) e.setThumbnail(target.displayAvatarURL({ size: 128 }));
    if (report.status !== 'open') e.addFields({ name: 'Status', value: `${report.status === 'resolved' ? '✅ Resolved' : '🗑️ Dismissed'} by <@${report.handledBy}> <t:${unix(report.handledAt)}:R>` });
    e.setFooter({ text: `Use /warn, /timeout or /ban if action is needed, then press a button.` });
    return e;
}

module.exports = {
    reportEmbed, buttons,
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Report a member to the staff team.')
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('Who you are reporting').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('What happened').setRequired(true).setMaxLength(1000)),

    async execute(interaction) {
        const { reports } = interaction.client.services;
        const { guild } = interaction;
        const target = interaction.options.getUser('user', true);
        const reason = cleanText(interaction.options.getString('reason', true), 1000);
        // A typed "!report @user ..." would show the report in public chat, so we remove the message (if we may).
        if (interaction.isTextCommand) interaction.sourceMessage?.delete?.().catch(() => {});
        await interaction.deferReply();
        let report = null;
        try {
            const config = reports.getConfig(guild.id);
            if (!config.channelId) return respond(interaction, 'Reports are not set up on this server yet. Ask an admin to run `/reportconfig channel`.');
            if (target.id === interaction.client.user.id) return respond(interaction, 'You cannot report me. 🙂');
            report = reports.create(guild.id, { reporterId: interaction.user.id, targetId: target.id, reason });
            const channel = await guild.channels.fetch(config.channelId).catch(() => null);
            if (!channel?.isTextBased?.()) { reports.discard(guild.id, report.number); return respond(interaction, 'I cannot reach the staff report channel right now. Please tell an admin.'); }
            const sent = await channel.send({
                content: config.pingRoleId ? `<@&${config.pingRoleId}>` : undefined,
                embeds: [reportEmbed(report, { sourceChannelId: interaction.channelId, target })], components: [buttons(report.number)],
                allowedMentions: config.pingRoleId ? { roles: [config.pingRoleId] } : { parse: [] },
            }).catch((error) => { logger.warn(`Report post failed in server ${guild.id}: ${error.message}`); return null; });
            if (!sent) { reports.discard(guild.id, report.number); return respond(interaction, 'I cannot post in the staff report channel. Please tell an admin.'); }
            reports.attachMessage(guild.id, report.number, sent.channelId ?? channel.id, sent.id);
            return respond(interaction, `✅ Thank you <@${interaction.user.id}>, your report (#${report.number}) was sent to the staff team.`);
        } catch (error) {
            if (error instanceof ReportServiceError) return respond(interaction, `⚠️ ${error.message}`);
            logger.error(`report failed in server ${guild.id}:`, error);
            if (report) reports.discard(guild.id, report.number);
            return respond(interaction, 'Something went wrong sending your report.');
        }
    },

    // The Resolve / Dismiss buttons on the staff message.
    async handleComponent(interaction) {
        const [, action, rawNumber] = interaction.customId.split(':');
        const number = Number(rawNumber);
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: 'You need the **Moderate Members** permission to handle reports.', allowedMentions: { parse: [] } });
        }
        const { reports } = interaction.client.services;
        const closed = reports.close(interaction.guildId, number, action === 'resolve' ? 'resolved' : 'dismissed', interaction.user.id);
        if (!closed) return interaction.reply({ content: 'Someone already handled this report.', allowedMentions: { parse: [] } });
        return interaction.update({ embeds: [reportEmbed(closed, { sourceChannelId: interaction.message?.embeds?.[0]?.fields?.find((f) => f.name === 'Channel')?.value?.replace(/\D/g, '') || null })], components: [buttons(number, true)] });
    },
};
