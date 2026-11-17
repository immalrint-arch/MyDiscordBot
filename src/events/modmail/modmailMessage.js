const { Events, ChannelType } = require('discord.js');
const logger = require('../../utils/logger');
const { handleDirectMessage, handleStaffMessage } = require('../../modmail/modmailFlow');

// DMs to the bot become modmail; staff messages in modmail channels go to the member.
module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        try {
            if (message.partial) await message.fetch().catch(() => {});
            if (message.author?.bot) return;
            if (!message.guildId || message.channel?.type === ChannelType.DM) return await handleDirectMessage(message);
            await handleStaffMessage(message);
        } catch (error) { logger.warn(`Modmail error: ${error.message}`); }
    },
};
