const { SlashCommandBuilder } = require('discord.js');
const { search } = require('../../help/catalog');
const { homePayload, commandPayload, searchPayload, indexFor, textPrefix } = require('../../help/helpFlow');
const { respond } = require('../../moderation/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Learn what I can do. New here? Start with this, then run /setup.')
        .addStringOption((o) => o.setName('command').setDescription('A command (ban), a command and action (level xp), or any word to search (punish)').setMaxLength(60)),

    async execute(interaction) {
        const uid = interaction.user.id;
        const query = interaction.options.getString('command');
        if (!query) return respond(interaction, null, homePayload(interaction.client, uid, { prefix: interaction.guildId ? textPrefix(interaction.client, interaction.guildId) : null }));
        const result = search(indexFor(interaction.client), query);
        if (result.exact) return respond(interaction, null, commandPayload(interaction.client, uid, result.exact));
        return respond(interaction, null, searchPayload(interaction.client, uid, query, result));
    },
};
