const { Events } = require('discord.js');
const logger = require('../../utils/logger');

// When verification has an "unverified" role, every new human member gets it until they pass.
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        if (member.user.bot) return;
        const config = member.client.services.verification.getConfig(member.guild.id);
        if (!config.enabled || !config.unverifiedRoleId) return;
        try {
            await member.roles.add(config.unverifiedRoleId, 'Joined: waiting for verification');
        } catch (error) {
            logger.warn(`Could not give the unverified role in server ${member.guild.id}: ${error.message}`);
        }
    },
};
