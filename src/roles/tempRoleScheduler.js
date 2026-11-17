const logger = require('../utils/logger');
const { logEmbed, COLORS, footerForUser } = require('../logging/style');

const CHECK_EVERY_MS = 30 * 1000;

// Removes temporary roles that ran out. Runs every 30 seconds and once at startup,
// so roles that expired while the bot was offline are removed too.
function startTempRoleScheduler(client) {
    let running = false;

    async function tick() {
        if (running) return;
        running = true;
        try {
            const { roles, logs } = client.services;
            for (const item of roles.dueTempRoles()) {
                const guild = client.guilds.cache.get(item.guildId);
                if (!guild) continue; // not in that server right now: try again later
                const member = await guild.members.fetch(item.userId).catch((error) => (error.code === 10007 ? null : undefined));
                if (member === undefined) continue; // Discord problem: keep the timer, try later
                if (member && member.roles.cache.has(item.roleId)) {
                    try {
                        await member.roles.remove(item.roleId, 'Temporary role expired');
                    } catch (error) {
                        if (error.code !== 10011) { // 10011 = role no longer exists
                            logger.warn(`Could not remove the expired role ${item.roleId} from ${item.userId} in server ${guild.id}: ${error.message}`);
                            continue;
                        }
                    }
                    await logs.send(guild, 'members', {
                        embeds: [logEmbed({
                            color: COLORS.blue,
                            title: 'Temporary Role Expired',
                            headline: `<@&${item.roleId}> was removed from <@${item.userId}> because its time ran out.`,
                            lines: item.reason ? [`**Reason it was given:** ${item.reason}`] : [],
                            footer: footerForUser(member.user, new Date()),
                        })],
                        allowedMentions: { parse: [] },
                    }, { userId: item.userId, roleIds: [...member.roles.cache.keys()] }).catch(() => {});
                }
                roles.clearTempRole(item.guildId, item.userId, item.roleId);
            }
        } catch (error) {
            logger.error('Temporary-role check failed:', error);
        } finally {
            running = false;
        }
    }

    tick();
    return setInterval(tick, CHECK_EVERY_MS);
}

module.exports = { startTempRoleScheduler };
