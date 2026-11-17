const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.GuildCreate, // runs when the bot is added to a server
    execute(guild) {
        guild.client.services.guildSettings.ensureGuild(guild.id);
        logger.info(`Joined a new server (ID ${guild.id}). Default settings created.`);
    },
};
