const { Events } = require('discord.js');
const logger = require('../../utils/logger');

// Someone who leaves while quarantined and comes back is put straight back into quarantine.
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            const { quarantine } = member.client.services;
            if (!quarantine.get(member.guild.id, member.id)) return;
            const roleId = quarantine.getConfig(member.guild.id).roleId;
            const role = roleId ? member.guild.roles.cache.get(roleId) : null;
            if (role) await member.roles.add(role, 'Still quarantined: they left and rejoined');
        } catch (error) {
            logger.warn(`Quarantine rejoin failed in server ${member.guild.id}: ${error.message}`);
        }
    },
};
