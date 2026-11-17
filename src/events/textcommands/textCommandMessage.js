const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleTextMessage } = require('../../textcommands/handler');

// "!ban @user reason" and friends. Off until a server owner runs /textcommands enable.
module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        try { await handleTextMessage(message); } catch (error) { logger.warn(`Text command error: ${error.message}`); }
    },
};
