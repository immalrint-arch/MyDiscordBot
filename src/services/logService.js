// Sends a log message to the right channel for a category.
// Logging must NEVER break the bot, so every failure is caught here.
//
//   logs.send(guild, 'members', { embeds: [embed] }, { userId, channelId, roleIds })
//
// The last argument says who/where the event was about, so ignore lists can apply.
function createLogService({ logConfig, logger }) {
    async function send(guild, category, payload, context = {}) {
        try {
            if (logConfig.isIgnored({ guildId: guild.id, ...context })) return false;

            const channelId = logConfig.getChannelId(guild.id, category);
            if (!channelId) return false;

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) {
                logger.warn(`Log channel ${channelId} (${category}) in server ${guild.id} is missing or not a text channel.`);
                return false;
            }

            // parse: [] means "never ping anyone", even if logged text contains @everyone.
            await channel.send({ ...payload, allowedMentions: { parse: [] } });
            return true;
        } catch (error) {
            logger.warn(`Could not write a ${category} log in server ${guild.id}: ${error.message}`);
            return false;
        }
    }

    return { send };
}

module.exports = { createLogService };
