const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleReaction } = require('../../roles/panelFlow');

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        try { await handleReaction(reaction, user, true, reaction.client); } catch (error) { logger.warn(`Reaction role error: ${error.message}`); }
    },
};
