const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleInviteLeave, saveStickyRoles } = require('../../growth/growthFlow');

// Invite numbers and sticky roles when someone leaves.
module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        handleInviteLeave(member);
        await saveStickyRoles(member).catch((e) => logger.warn(`Sticky roles save error: ${e.message}`));
    },
};
