const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleResponderMessage } = require('../../custom/customFlow');

// Auto-replies (see /autoresponder).
module.exports = {
    name: Events.MessageCreate,
    async execute(message) { try { await handleResponderMessage(message); } catch (error) { logger.warn(`Auto-reply error: ${error.message}`); } },
};
