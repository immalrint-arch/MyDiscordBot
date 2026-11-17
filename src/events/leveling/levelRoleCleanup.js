const { Events } = require('discord.js');

// When a role is deleted, forget it in the level roles, boosts and ignore list.
module.exports = {
    name: Events.GuildRoleDelete,
    async execute(role) { role.client.services.levels.removeRoleEverywhere(role.guild.id, role.id); },
};
