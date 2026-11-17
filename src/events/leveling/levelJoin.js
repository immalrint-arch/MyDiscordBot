const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { applyLevelRoles } = require('../../leveling/levelFlow');

// Someone who comes back keeps their level, so give their reward roles back.
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            if (member.user.bot || member.pending) return;
            const { levels } = member.client.services;
            if (!levels.getConfig(member.guild.id).enabled) return;
            const { level } = levels.getUser(member.guild.id, member.id);
            if (level > 0) await applyLevelRoles(member, level, member.client);
        } catch (error) { logger.warn(`Level roles on join failed: ${error.message}`); }
    },
};
