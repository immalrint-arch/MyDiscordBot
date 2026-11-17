const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleMessage } = require('../../leveling/levelFlow');

// Gives XP for chatting.
module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        try { await handleMessage(message); } catch (error) { logger.warn(`Leveling error: ${error.message}`); }
    },
};
