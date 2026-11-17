const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleStickyMessage } = require('../../posts/postFlow');

// Moves sticky messages back to the bottom (see /sticky).
module.exports = {
    name: Events.MessageCreate,
    async execute(message) { try { await handleStickyMessage(message); } catch (error) { logger.warn(`Sticky error: ${error.message}`); } },
};
