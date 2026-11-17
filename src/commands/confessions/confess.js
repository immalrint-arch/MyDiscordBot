const { SlashCommandBuilder } = require('discord.js');
const { MAX_LENGTH } = require('../../confessions/confessionRules');
const { submitConfession, openForm, whereProblem, refuse } = require('../../confessions/confessionFlow');
const { ConfessionServiceError } = require('../../services/confessionService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('confess')
        .setDescription('Post an anonymous confession (only works in the confession channel).')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('text').setDescription('Your confession. Leave empty to open a bigger form.').setMaxLength(MAX_LENGTH)),

    async execute(interaction) {
        const { confessions } = interaction.client.services;
        const config = confessions.getConfig(interaction.guildId);
        const where = whereProblem(interaction, config);
        if (where) return refuse(interaction, where);
        const text = interaction.options.getString('text');
        if (text) return submitConfession(interaction, text);
        try { confessions.check(interaction.guildId, interaction.user.id); } catch (error) {
            if (error instanceof ConfessionServiceError) return refuse(interaction, `⚠️ ${error.message}`);
            throw error;
        }
        return openForm(interaction);
    },
};
