const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../../utils/logger');
const { respond, describeError } = require('../../moderation/helpers');
const { parseDuration } = require('../../utils/duration');
const { PollServiceError } = require('../../services/pollService');
const { pollPayload, endPoll } = require('../../utility/utilityFlow');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create polls that people vote on with buttons.')
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('create').setDescription('Create a poll.')
            .addStringOption((o) => o.setName('question').setDescription('What to ask').setRequired(true).setMaxLength(250))
            .addStringOption((o) => o.setName('options').setDescription('2 to 10 options separated by | , e.g. Pizza | Burgers | Tacos').setRequired(true).setMaxLength(900))
            .addStringOption((o) => o.setName('duration').setDescription('How long it runs, e.g. 30m, 2h, 7d (empty = until you end it)'))
            .addBooleanOption((o) => o.setName('multiple').setDescription('Let people pick more than one option')))
        .addSubcommand((s) => s.setName('end').setDescription('End a poll now (the creator or a moderator).')
            .addIntegerOption((o) => o.setName('number').setDescription('The poll number (shown on the poll)').setRequired(true).setMinValue(1)))
        .addSubcommand((s) => s.setName('list').setDescription('Show the open polls.')),

    async execute(interaction) {
        const { polls } = interaction.client.services;
        const { guild } = interaction;
        const sub = interaction.options.getSubcommand();
        if (sub === 'list') {
            const open = polls.listOpen(guild.id);
            return respond(interaction, open.length ? ['**Open polls**', ...open.map((p) => `▸ **#${p.number}** ${p.question.slice(0, 80)} — <#${p.channelId}>`)].join('\n') : 'There are no open polls.');
        }
        if (sub === 'end') {
            const number = interaction.options.getInteger('number', true);
            const poll = polls.get(guild.id, number);
            if (!poll) return respond(interaction, `There is no poll #${number}.`);
            const allowed = poll.creatorId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
            if (!allowed) return respond(interaction, 'Only the poll creator or a moderator (Manage Messages) can end it.');
            await interaction.deferReply();
            const ended = await endPoll(interaction.client, guild.id, number);
            return respond(interaction, ended ? `✅ Poll #${number} ended.` : `Poll #${number} was already ended.`);
        }
        let poll = null;
        try {
            const raw = interaction.options.getString('duration');
            const durationMs = raw ? parseDuration(raw) : null;
            if (raw && !durationMs) return respond(interaction, 'I could not read that duration. Use something like 30m, 2h or 7d.');
            poll = polls.create(guild.id, { channelId: interaction.channelId, creatorId: interaction.user.id, question: interaction.options.getString('question', true),
                optionsText: interaction.options.getString('options', true), multiple: interaction.options.getBoolean('multiple') ?? false, durationMs });
            await interaction.deferReply();
            const message = await respond(interaction, null, pollPayload(poll, polls.results(poll.id)));
            polls.attachMessage(guild.id, poll.number, message?.id ?? (await interaction.fetchReply())?.id);
        } catch (error) {
            if (error instanceof PollServiceError) return respond(interaction, `⚠️ ${error.message}`);
            logger.error(`poll create failed in server ${guild.id}:`, error);
            if (poll) polls.discard(guild.id, poll.number);
            return respond(interaction, `I couldn't create the poll: ${describeError(error)}.`);
        }
    },
};
