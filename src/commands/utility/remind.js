const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../moderation/helpers');
const { ReminderServiceError } = require('../../services/reminderService');
const { parseWhen, unix } = require('../../giveaways/giveawayRules');
const { cleanText } = require('../../utils/text');
const { MAX_REMIND_TEXT } = require('../../utility/rules');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remind')
        .setDescription('Get a reminder later.')
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('add').setDescription('Remind me about something.')
            .addStringOption((o) => o.setName('when').setDescription('In how long (10m, 2h, 1d12h) or a date like 2026-12-24 18:00').setRequired(true).setMaxLength(40))
            .addStringOption((o) => o.setName('text').setDescription('What to remind you about').setRequired(true).setMaxLength(MAX_REMIND_TEXT))
            .addIntegerOption((o) => o.setName('utc-offset').setDescription('Only for dates: your time zone, e.g. 8 for UTC+8 (default 0)').setMinValue(-12).setMaxValue(14)))
        .addSubcommand((s) => s.setName('list').setDescription('Show my reminders.'))
        .addSubcommand((s) => s.setName('cancel').setDescription('Cancel one of my reminders.')
            .addIntegerOption((o) => o.setName('id').setDescription('The reminder ID from /remind list').setRequired(true).setMinValue(1))),

    async execute(interaction) {
        const { reminders } = interaction.client.services;
        const { guild } = interaction;
        const sub = interaction.options.getSubcommand();
        const mention = `<@${interaction.user.id}>`;
        if (sub === 'list') {
            const list = reminders.listForUser(guild.id, interaction.user.id);
            return respond(interaction, list.length ? [`**Reminders for ${mention}**`, ...list.slice(0, 25).map((r) => `▸ **ID ${r.id}** <t:${unix(r.dueAt)}:R> — ${r.text.slice(0, 80)}`)].join('\n') : `${mention} you have no reminders.`, { allowedMentions: { parse: [] } });
        }
        if (sub === 'cancel') {
            const id = interaction.options.getInteger('id', true);
            return respond(interaction, reminders.cancel(guild.id, interaction.user.id, id) ? `✅ Reminder ${id} cancelled.` : `You have no pending reminder with ID ${id}.`);
        }
        const now = Date.now();
        const at = parseWhen(interaction.options.getString('when', true), { now, offsetHours: interaction.options.getInteger('utc-offset') ?? 0 });
        if (!at) return respond(interaction, 'I could not read that time. Use something like `10m`, `2h`, `1d12h`, or a date like `2026-12-24 18:00`.');
        try {
            const r = reminders.create(guild.id, { userId: interaction.user.id, channelId: interaction.channelId, text: cleanText(interaction.options.getString('text', true), MAX_REMIND_TEXT), delayMs: at - now });
            return respond(interaction, `⏰ Okay ${mention}, I will remind you <t:${unix(r.dueAt)}:R> (<t:${unix(r.dueAt)}:f>): ${r.text}\nReminder ID: **${r.id}**`, { allowedMentions: { parse: [] } });
        } catch (error) {
            if (error instanceof ReminderServiceError) return respond(interaction, `⚠️ ${error.message}`);
            throw error;
        }
    },
};
