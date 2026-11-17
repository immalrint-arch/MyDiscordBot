const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleMessage } = require('../../fun/funFlow');

// Counting channel, AFK notices and bump detection.
module.exports = {
    name: Events.MessageCreate,
    async execute(message) { try { await handleMessage(message); } catch (error) { logger.warn(`Fun message error: ${error.message}`); } },
};
