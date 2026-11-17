const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleVoiceChange } = require('../../channels/tempVoiceFlow');

// Creates and removes temporary voice rooms.
module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        try { await handleVoiceChange(oldState, newState, newState.client); } catch (error) { logger.warn(`Temporary voice error: ${error.message}`); }
    },
};
