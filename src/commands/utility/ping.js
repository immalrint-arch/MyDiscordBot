const { SlashCommandBuilder } = require('discord.js');

// Quick "are you alive?" check. Shows how long a round trip to Discord takes.
module.exports = {
    data: new SlashCommandBuilder().setName('ping').setDescription('Check that the bot is awake and how fast it answers.'),
    async execute(interaction) {
        await interaction.reply({ content: '🏓 Pinging…', allowedMentions: { parse: [] } });
        const sent = await interaction.fetchReply();
        const roundTrip = Math.max(0, sent.createdTimestamp - interaction.createdTimestamp);
        const socket = Math.round(interaction.client.ws?.ping ?? 0);
        await interaction.editReply({ content: `🏓 Pong! Reply took **${roundTrip} ms** · connection to Discord **${socket < 0 ? '?' : socket} ms**.`, allowedMentions: { parse: [] } });
    },
};
