const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { respond } = require('../../moderation/helpers');
const { SuggestionServiceError } = require('../../services/suggestionService');
const { suggestionPayload } = require('../../utility/utilityFlow');
const { MAX_SUGGESTION } = require('../../utility/rules');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Send a suggestion to the server. Everyone can vote on it.')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('text').setDescription('Your suggestion').setRequired(true).setMaxLength(MAX_SUGGESTION)),

    async execute(interaction) {
        const { suggestions } = interaction.client.services;
        const { guild } = interaction;
        const channelId = suggestions.getChannelId(guild.id);
        if (!channelId) return respond(interaction, 'Suggestions are not set up. An admin can run `/suggestion setup`.');
        await interaction.deferReply();
        let s = null;
        try {
            s = suggestions.create(guild.id, { authorId: interaction.user.id, content: interaction.options.getString('text', true) });
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel?.isTextBased?.()) { suggestions.discard(guild.id, s.number); return respond(interaction, 'I cannot reach the suggestions channel. Please tell an admin.'); }
            const sent = await channel.send(suggestionPayload(s, { up: 0, down: 0 }, interaction.user)).catch(() => null);
            if (!sent) { suggestions.discard(guild.id, s.number); return respond(interaction, 'I cannot post in the suggestions channel. Please tell an admin.'); }
            suggestions.attachMessage(guild.id, s.number, channel.id, sent.id);
            return respond(interaction, `✅ Your suggestion **#${s.number}** was posted in <#${channel.id}>.`);
        } catch (error) {
            if (error instanceof SuggestionServiceError) return respond(interaction, `⚠️ ${error.message}`);
            logger.error(`suggest failed in server ${guild.id}:`, error);
            if (s) suggestions.discard(guild.id, s.number);
            return respond(interaction, 'Something went wrong sending your suggestion.');
        }
    },
};
