const logger = require('../utils/logger');
const { caseEmbed } = require('../utils/embeds');

const CHECK_EVERY_MS = 30 * 1000;

// Lifts bans that have run out. Runs every 30 seconds, and right at startup so bans that
// expired while the bot was offline are lifted too.
function startTempBanScheduler(client) {
    let running = false;

    async function tick() {
        if (running) return; // never run two checks at once
        running = true;
        try {
            const { tempBans, cases, modLog, suppress } = client.services;
            for (const item of tempBans.due()) {
                const guild = client.guilds.cache.get(item.guildId);
                if (!guild) continue; // we are not in that server right now; try again later
                try {
                    suppress.mark(guild.id, 'unban', item.userId);
                    await guild.members.unban(item.userId, 'Temporary ban expired');
                } catch (error) {
                    if (error.code !== 10026) { // 10026 = already unbanned: just forget the timer
                        logger.warn(`Could not lift the temporary ban of ${item.userId} in server ${guild.id}: ${error.message}`);
                        continue; // keep the timer and try again next time
                    }
                }
                tempBans.clear(item.guildId, item.userId);
                try {
                    const record = cases.createCase({
                        guildId: guild.id, type: 'unban', targetId: item.userId, moderatorId: client.user.id,
                        reason: `Temporary ban expired (case #${item.caseNumber ?? '?'})`,
                    });
                    const user = await client.users.fetch(item.userId).catch(() => null);
                    await modLog.send(guild, { embeds: [caseEmbed(record, { target: user, moderator: client.user })] });
                } catch (error) {
                    logger.warn(`Could not record the end of a temporary ban in server ${guild.id}: ${error.message}`);
                }
            }
        } catch (error) {
            logger.error('Temporary-ban check failed:', error);
        } finally {
            running = false;
        }
    }

    tick();
    return setInterval(tick, CHECK_EVERY_MS);
}

module.exports = { startTempBanScheduler };
