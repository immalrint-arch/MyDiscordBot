const logger = require('../utils/logger');
const { roleProblem } = require('./roleRules');

// Which automatic roles apply to this member right now. Pure, so it is easy to test.
//   configs: [{ roleId, target: 'humans'|'bots'|'all', timing: 'join'|'verified' }]
function selectAutoRoles(configs, { isBot, timing }) {
    return configs
        .filter((c) => c.timing === timing && (c.target === 'all' || (c.target === 'bots') === Boolean(isBot)))
        .map((c) => c.roleId);
}

// Gives the automatic roles. Roles that became unsafe (powerful, above the bot) are skipped.
async function applyAutoRoles(member, timing, client) {
    const { roles } = client.services;
    const guild = member.guild;
    const ids = selectAutoRoles(roles.listAutoRoles(guild.id), { isBot: member.user.bot, timing });
    if (!ids.length) return [];
    const me = guild.members.me ?? await guild.members.fetchMe();
    const safe = [];
    for (const id of ids) {
        const role = guild.roles.cache.get(id);
        const problem = roleProblem({ role, guildId: guild.id, botHighestPosition: me.roles.highest.position, forbidDangerous: true });
        if (problem) logger.warn(`Automatic role ${id} skipped in server ${guild.id}: ${problem}`);
        else if (!member.roles.cache.has(id)) safe.push(id);
    }
    if (!safe.length) return [];
    try {
        await member.roles.add(safe, 'Automatic role');
        return safe;
    } catch (error) {
        logger.warn(`Could not give automatic roles in server ${guild.id}: ${error.message}`);
        return [];
    }
}

module.exports = { selectAutoRoles, applyAutoRoles };
