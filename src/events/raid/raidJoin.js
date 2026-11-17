const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { handleRaidJoin } = require('../../raid/raidFlow');

// Watches for a sudden wave of new members (see /raidmode).
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) { try { await handleRaidJoin(member); } catch (error) { logger.warn(`Raid mode error: ${error.message}`); } },
};
