const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleInviteJoin, restoreStickyRoles } = require('../../growth/growthFlow');

// Invite tracking and sticky roles when someone joins.
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        await handleInviteJoin(member).catch((e) => logger.warn(`Invite join error: ${e.message}`));
        await restoreStickyRoles(member).catch((e) => logger.warn(`Sticky roles error: ${e.message}`));
    },
};
