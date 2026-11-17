const { Events } = require('discord.js');
const { handleStarReaction } = require('../../utility/utilityFlow');

module.exports = {
    name: Events.MessageReactionRemove,
    async execute(reaction, user) {
        if (user?.bot) return;
        await handleStarReaction(reaction, reaction.client);
    },
};
